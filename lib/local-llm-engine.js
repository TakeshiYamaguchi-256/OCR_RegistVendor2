// local-llm-engine.js の修正版（重複宣言エラー対応）


// 重複読み込み防止チェック
if (typeof window.LocalLLMEngine === 'undefined') {
  
  class LocalLLMEngine {
    constructor() {
      this.engine = null;
      this.initialized = false;
      this.modelName = null;
      this.isLoading = false;
      this.webllmLoaded = false;
    }

   // ===== 修正: Content Script内でのWebLLM読み込み =====
async loadWebLLM() {
  if (this.webllmLoaded && window.webllm) {
    console.log('WebLLMは既に読み込まれています');
    return true;
  }

  try {
    console.log('WebLLMライブラリを読み込み中...');
    
    // ===== 修正: Content Script内でのみ外部ライブラリを読み込み =====
    // Popup内ではなく、Content Script内で読み込むため、CSP制限を回避
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.79/lib/index.min.js';
    script.crossOrigin = 'anonymous';
    
    await new Promise((resolve, reject) => {
      script.onload = () => {
        console.log('WebLLMスクリプトの読み込み完了');
        resolve();
      };
      script.onerror = (error) => {
        console.error('WebLLMスクリプト読み込みエラー:', error);
        reject(new Error('WebLLMスクリプトの読み込みに失敗'));
      };
      document.head.appendChild(script);
    });

    // WebLLMオブジェクトの確実な待機
    let attempts = 0;
    const maxAttempts = 100;
    
    while (!window.webllm && attempts < maxAttempts) {
      console.log(`WebLLM待機中... (${attempts + 1}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }

    if (!window.webllm) {
      throw new Error('WebLLMオブジェクトが利用できません');
    }

    // WebLLMの基本機能をテスト
    if (typeof window.webllm.CreateMLCEngine !== 'function') {
      throw new Error('WebLLM.CreateMLCEngine関数が利用できません');
    }

    this.webllmLoaded = true;
    console.log('WebLLMライブラリが正常に読み込まれました');
    return true;

  } catch (error) {
    console.error('WebLLM読み込みエラー:', error);
    this.webllmLoaded = false;
    throw error;
  }
}

    // ===== 修正: 初期化処理の安定化 =====
    async initialize(modelName = 'Phi-3-mini-4k-instruct-q4f16_1-MLC', modelPath = null) {
      if (this.isLoading) {
        console.log('モデル読み込み中です...');
        return false;
      }

      if (this.initialized && this.modelName === modelName) {
        console.log('モデルは既に初期化済みです');
        return true;
      }

      // モデル名の検証
      const availableModels = this.getAvailableModels();
      if (!availableModels.includes(modelName)) {
        console.warn(`指定されたモデル "${modelName}" は利用できません。利用可能なモデル:`, availableModels);
        throw new Error(`モデル "${modelName}" は利用できません`);
      }

      this.isLoading = true;
      this.modelName = modelName;

      try {
        // WebLLMライブラリの読み込み
        await this.loadWebLLM();

        console.log(`ローカルLLMモデル "${modelName}" を初期化中...`);
        
        // ===== 修正: プログレス表示の改善 =====
        const progressCallback = (report) => {
          const progressText = report.text || 'ダウンロード中';
          console.log(`モデル読み込み進捗: ${progressText}`);
          
          let progress = 0;
          if (typeof report.progress === 'number') {
            progress = Math.min(100, Math.max(0, report.progress * 100));
          }
          
          // popup.jsに進捗を送信（安全に）
          try {
            if (chrome?.runtime?.sendMessage) {
              chrome.runtime.sendMessage({
                action: "updateModelProgress",
                progress: progress,
                text: progressText
              }).catch(() => {
                // 送信失敗は無視（popup.jsが開いていない場合など）
              });
            }
          } catch (e) {
            // 送信エラーは無視
          }
          
          // ページ内プログレスバーの更新
          const progressBar = document.getElementById('progressBar');
          if (progressBar) {
            progressBar.style.width = `${progress}%`;
            progressBar.textContent = `${Math.round(progress)}%`;
          }
        };

        // ===== 修正: WebLLMエンジン作成（エラーハンドリング強化） =====
        let engine = null;
        
        try {
          console.log('WebLLMエンジンを作成中...');
          
          const initOptions = {
            initProgressCallback: progressCallback,
            // ===== 追加: 追加設定 =====
            logLevel: 'WARN', // ログレベルを下げる
            useGPU: true
          };

          if (modelPath) {
            initOptions.modelPath = chrome.runtime.getURL(modelPath);
          }

          const initPromise = window.webllm.CreateMLCEngine(modelName, initOptions);
          
          // ===== 修正: タイムアウト時間を延長（大きなモデル対応） =====
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('モデル初期化がタイムアウトしました（10分）')), 10 * 60 * 1000);
          });
          
          engine = await Promise.race([initPromise, timeoutPromise]);
          
        } catch (engineError) {
          console.error('WebLLMエンジン作成エラー:', engineError);
          
          // ===== 追加: より詳細なエラー情報 =====
          let detailedError = engineError.message;
          if (engineError.message.includes('timeout')) {
            detailedError = 'モデルのダウンロードまたは初期化がタイムアウトしました。ネットワーク接続を確認するか、より小さなモデルを選択してください。';
          } else if (engineError.message.includes('fetch')) {
            detailedError = 'モデルのダウンロードに失敗しました。ネットワーク接続を確認してください。';
          } else if (engineError.message.includes('WebGL') || engineError.message.includes('GPU')) {
            detailedError = 'GPU初期化に失敗しました。ブラウザでWebGLが有効になっているか確認してください。';
          }
          
          throw new Error(detailedError);
        }

        if (!engine) {
          throw new Error('WebLLMエンジンの作成に失敗しました');
        }

        this.engine = engine;
        this.initialized = true;
        console.log('ローカルLLM初期化完了');
        
        // 完了を通知
        progressCallback({ progress: 1.0, text: '初期化完了' });
        
        // ===== 追加: 初期化成功をストレージに保存 =====
        try {
          await chrome.storage.local.set({
            'localLLMInitialized': true,
            'localLLMModel': modelName,
            'localLLMLastInitialized': Date.now()
          });
          console.log('初期化状態をストレージに保存しました');
        } catch (storageError) {
          console.warn('ストレージ保存エラー（続行します）:', storageError);
        }
        
        return true;

      } catch (error) {
        console.error('ローカルLLM初期化エラー:', error);
        this.initialized = false;
        this.engine = null;
        
        // エラーをpopup.jsに通知
        try {
          if (chrome?.runtime?.sendMessage) {
            chrome.runtime.sendMessage({
              action: "modelInitializationError",
              error: error.message
            }).catch(() => {
              // 送信失敗は無視
            });
          }
        } catch (e) {
          // 送信エラーは無視
        }
        
        // ===== 追加: エラー状態をストレージに保存 =====
        try {
          await chrome.storage.local.set({
            'localLLMInitialized': false,
            'localLLMInitializationError': error.message,
            'localLLMLastError': Date.now()
          });
        } catch (storageError) {
          console.warn('エラー状態のストレージ保存エラー:', storageError);
        }
        
        throw error;
      } finally {
        this.isLoading = false;
      }
    }

    // ===== 修正: テキスト抽出処理の安定化 =====
    async extractText(imageData, options = {}) {
      if (!this.initialized || !this.engine) {
        throw new Error('ローカルLLMが初期化されていません');
      }

      console.log('ローカルLLMでテキスト抽出中...');
      
      try {
        // プロンプト生成
        const prompt = this.generatePrompt(options.fieldType);
        
        // ===== 修正: メッセージ形式の改善 =====
        const messages = [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { 
                type: "image_url", 
                image_url: { url: imageData } 
              }
            ]
          }
        ];

        // ===== 修正: チャット補完の設定改善 =====
        const response = await this.engine.chat.completions.create({
          messages: messages,
          temperature: 0.1,    // より確定的な出力
          max_tokens: 1000,    // トークン数を増加
          top_p: 0.9,         // 追加設定
          stream: false
        });

        const extractedText = response.choices[0]?.message?.content || '';
        
        if (!extractedText.trim()) {
          throw new Error('ローカルLLMから空の応答が返されました');
        }

        console.log('ローカルLLMテキスト抽出成功:', extractedText.substring(0, 100) + '...');

        return {
          text: extractedText.trim(),
          confidence: 0.85,
          source: 'local-llm',
          model: this.modelName
        };

      } catch (error) {
        console.error('ローカルLLMテキスト抽出エラー:', error);
        throw error;
      }
    }

    // 残りのメソッドは変更なし...
    generatePrompt(fieldType) {
      switch (fieldType) {
        case 'phone-number':
          return "この画像に含まれる電話番号を正確に抽出してください。数字、ハイフン、カンマのみを返してください。例: 03-1234-5678。複数の電話番号がある場合はカンマで区切ってください。";
        
        case 'payee-name':
          return "この画像から会社名を抽出してください。法人格（株式会社など）と支店名は除いて、正確な名称のみを返してください。複数ある場合はカンマで区切ってください。";
        
        case 'phonetic':
          return "この画像からふりがなを抽出してください。ひらがなで返してください。";
        
        default:
          return "この画像に含まれるテキストを正確に抽出してください。レイアウトは無視して純粋なテキストのみを出力してください。";
      }
    }

    async switchModel(newModelName, modelPath = null) {
      if (this.modelName === newModelName) {
        return true;
      }
      
      console.log(`モデルを ${this.modelName} から ${newModelName} に切り替え中...`);
      
      await this.cleanup();
      return await this.initialize(newModelName, modelPath);
    }

    async cleanup() {
      try {
        if (this.engine && typeof this.engine.unload === 'function') {
          await this.engine.unload();
        }
        
        this.engine = null;
        this.initialized = false;
        this.modelName = null;
        
        console.log('ローカルLLMリソースをクリーンアップしました');
      } catch (error) {
        console.warn('クリーンアップ中にエラー:', error);
      }
    }

    getStatus() {
      return {
        initialized: this.initialized,
        loading: this.isLoading,
        modelName: this.modelName,
        webllmLoaded: this.webllmLoaded
      };
    }

    getAvailableModels() {
      return [
        'Phi-3-mini-4k-instruct-q4f16_1-MLC',
        'Phi-3.5-mini-instruct-q4f16_1-MLC',
        'Llama-3.2-1B-Instruct-q4f16_1-MLC',
        'Llama-3.2-3B-Instruct-q4f16_1-MLC',
        'gemma-2-2b-it-q4f16_1-MLC',
        'gemma-2-9b-it-q4f32_1-MLC',
        'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
        'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
        'Qwen2.5-3B-Instruct-q4f16_1-MLC',
        'Mistral-7B-Instruct-v0.3-q4f16_1-MLC'
      ];
    }

    getModelRecommendations() {
      return {
        'Phi-3-mini-4k-instruct-q4f16_1-MLC': {
          size: '2.4GB',
          speed: 'fast',
          quality: 'good',
          recommended: true,
          description: '高速で軽量、OCRに適している'
        },
        'Llama-3.2-3B-Instruct-q4f16_1-MLC': {
          size: '2.0GB', 
          speed: 'medium',
          quality: 'high',
          recommended: true,
          description: '高精度、テキスト理解に優れている'
        },
        'Llama-3.2-1B-Instruct-q4f16_1-MLC': {
          size: '800MB',
          speed: 'very fast',
          quality: 'good',
          recommended: false,
          description: '最軽量、低性能デバイス向け'
        },
        'gemma-2-2b-it-q4f16_1-MLC': {
          size: '1.6GB',
          speed: 'fast',
          quality: 'good',
          recommended: false,
          description: 'Google製、バランス型'
        }
      };
    }
  }

  // グローバルに公開（重複チェック済み）
  window.LocalLLMEngine = LocalLLMEngine;
  if (typeof window.localLLMEngine === 'undefined') {
    window.localLLMEngine = new LocalLLMEngine();
  }
  console.log('WebLLM対応ローカルLLMエンジンが利用可能になりました');
  
} else {
  console.log('LocalLLMEngineは既に定義されています - スキップ');
}
