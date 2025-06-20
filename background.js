// background.js
// Gemini APIを使用したOCR実装

// バックグラウンドスクリプト内の状態
let isProcessingCancelled = false;
let currentProcessingTabId = null;

const activeProcessing = new Set(); // 処理中のタブIDを管理

function isTabProcessing(tabId) {
  return activeProcessing.has(tabId);
}

function setTabProcessing(tabId, processing) {
  if (processing) {
    activeProcessing.add(tabId);
  } else {
    activeProcessing.delete(tabId);
  }
}

// セキュアなAPIキー管理クラス
class SecureAPIKeyManager {
  constructor() {
    this.hashedKey = null;
  }
  
  // APIキーを検証するが露出しない
  async validateKey() {
    const result = await chrome.storage.local.get(['geminiApiKey']);
    return !!(result.geminiApiKey && result.geminiApiKey.startsWith('AIza'));
  }
  
  // APIキーの存在のみを確認
  async keyExists() {
    const result = await chrome.storage.local.get(['geminiApiKey']);
    return !!(result.geminiApiKey && result.geminiApiKey.length > 10);
  }
  
  // APIキーを安全に取得（バックグラウンドスクリプト内でのみ使用）
  async getKey() {
    const result = await chrome.storage.local.get(['geminiApiKey']);
    return result.geminiApiKey || null;
  }
}

const secureKeyManager = new SecureAPIKeyManager();

// 設定のキャッシュ - グローバル変数として初期化
let cachedSettings = {
  apiKey: null,
  language: 'ja', 
  mode: 'accurate',
  model: 'gemini-2.0-flash',
  lastUpdate: 0
};

// 設定のキャッシュ
async function getCachedSettings() {
  const result = await chrome.storage.session.get(['cachedSettings']);
  return result.cachedSettings || {
    apiKey: null,
    language: 'ja', 
    mode: 'accurate',
    model: 'gemini-2.0-flash',
    lastUpdate: 0
  };
}

async function setCachedSettings(settings) {
  await chrome.storage.session.set({cachedSettings: settings});
}


// 設定を読み込む関数
async function loadSettings() {
  try {
    // 最後の更新から30秒以内ならキャッシュを使用
    if (cachedSettings && cachedSettings.lastUpdate && 
        Date.now() - cachedSettings.lastUpdate < 30000 && 
        cachedSettings.apiKey) {
      return cachedSettings;
    }
    
    const result = await chrome.storage.local.get(['geminiApiKey', 'ocrLanguage', 'ocrMode', 'geminiModel']);
    
    cachedSettings = {
      apiKey: result.geminiApiKey || null,
      language: result.ocrLanguage || 'ja',
      mode: result.ocrMode || 'accurate',
      model: result.geminiModel || 'gemini-2.0-flash',
      lastUpdate: Date.now()
    };
    
    return cachedSettings;
  } catch (error) {
    console.error('設定読み込みエラー:', error);
    // エラー時はデフォルト値を返す
    return {
      apiKey: null,
      language: 'ja',
      mode: 'accurate',
      model: 'gemini-2.0-flash',
      lastUpdate: Date.now()
    };
  }
}




const MODEL_STATUS_KEY = 'localModelStatus';

// モデルの状態を取得 (not_initialized, initializing, initialized, failed)
async function getModelStatus() {
  const result = await chrome.storage.local.get(MODEL_STATUS_KEY);
  return result[MODEL_STATUS_KEY] || { status: 'not_initialized' };
}

// モデルの状態を保存
async function setModelStatus(status, data = {}) {
  const statusObject = { status, ...data };
  await chrome.storage.local.set({ [MODEL_STATUS_KEY]: statusObject });
  console.log('Model status updated:', statusObject);
}

// ローカルモデル関連の定数を追加
const LOCAL_MODEL_FILENAME = 'local-llm-model.bin'; // ← この定数を追加

// ファイルシステムにモデルファイルが存在するか確認
async function checkModelFileExists() {
  // if (!filename) return false; ← この行を削除
  try {
    const root = await navigator.storage.getDirectory();
    await root.getFileHandle(LOCAL_MODEL_FILENAME);
    return true;
  } catch (e) {
    if (e.name === 'NotFoundError') {
      return false;
    }
    console.error("Error checking for model file:", e);
    return false;
  }
}

// 拡張機能起動時にファイル存在をチェックして状態を同期
chrome.runtime.onStartup.addListener(async () => {
    const fileExists = await checkModelFileExists();
    const currentStatus = await getModelStatus();
    if (fileExists) {
        if (currentStatus.status !== 'initialized') {
            await setModelStatus('initialized', { path: LOCAL_MODEL_FILENAME });
        }
    } else {
        if (currentStatus.status === 'initialized') {
             await setModelStatus('not_initialized');
        }
    }
});

// ダウンロード状態の変更を監視
chrome.downloads.onChanged.addListener(async (delta) => {
    const status = await getModelStatus();
    if (!status.downloadId || delta.id !== status.downloadId) return;

    if (delta.state) {
        if (delta.state.current === 'complete') {
            console.log('Model download complete.');
            if ((await checkModelFileExists())) {
                await setModelStatus('initialized', { path: LOCAL_MODEL_FILENAME });
            } else {
                await setModelStatus('failed', { error: 'File not found after download.' });
            }
        } else if (delta.state.current === 'interrupted') {
            await setModelStatus('failed', { error: 'Download interrupted.' });
        }
    }
});




// ローカルLLM初期化ハンドラーの修正
async function handleInitializeLocalLLM(request, sender, sendResponse) {
  try {
    const modelKey = request.model || 'phi3-mini';
    const modelConfig = LOCAL_LLM_MODELS[modelKey];
    
    if (!modelConfig) {
      throw new Error(`未対応のモデル: ${modelKey}`);
    }
    
    console.log(`ローカルLLM初期化開始: ${modelConfig.displayName}`);
    
    // WebLLMを使用する場合、実際のダウンロードはWebLLMライブラリが処理
    // Content scriptに初期化指示を送信
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    if (tabs.length === 0) {
      throw new Error('アクティブなタブが見つかりません');
    }
    
    const tabId = tabs[0].id;
    const result = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, {
        action: 'initializeLocalLLMModel',
        model: modelConfig.webllmName // WebLLM形式のモデル名を送信
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
    
    if (result && result.success) {
      await chrome.storage.local.set({
        'localLLMInitialized': true,
        'localLLMModel': modelConfig.webllmName,
        'preferredLocalModel': modelKey // ユーザー選択のモデルキー
      });
      
      sendResponse({ 
        success: true, 
        model: modelConfig.displayName
      });
    } else {
      throw new Error(result?.error || '初期化に失敗しました');
    }
    
  } catch (error) {
    console.error('ローカルLLM初期化エラー:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// モデル情報取得用ヘルパー関数
function getModelConfig(modelKey) {
  return LOCAL_LLM_MODELS[modelKey] || null;
}

function getAllModelConfigs() {
  return LOCAL_LLM_MODELS;
}
/**
 * ローカルLLMエンジンを初期化
 */
async function initializeLocalLLMEngine() {
  try {
    console.log('ローカルLLMエンジンの初期化を開始します');
    
    // Service Workerでは直接DOM操作ができないため、
    // アクティブなタブでスクリプトを実行
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    if (tabs.length === 0) {
      throw new Error('アクティブなタブが見つかりません');
    }
    
    const tabId = tabs[0].id;
    
    // ローカルLLMエンジンスクリプトを注入
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['lib/local-llm-engine.js']
    });
    
    console.log('ローカルLLMエンジンスクリプトを注入しました');
    return { success: true };
    
  } catch (error) {
    console.error('ローカルLLMエンジン初期化エラー:', error);
    return { success: false, error: error.message };
  }
}

/**
 * ハイブリッドOCRマネージャーを更新
 */
async function updateHybridOCRManager() {
  try {
    // enhanced-hybrid-ocr-manager.jsスクリプトを注入
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    if (tabs.length === 0) {
      throw new Error('アクティブなタブが見つかりません');
    }
    
    await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      files: ['lib/enhanced-hybrid-ocr-manager.js']
    });
    
    console.log('Enhanced Hybrid OCR Managerを更新しました');
    return true;
    
  } catch (error) {
    console.error('ハイブリッドOCRマネージャー更新エラー:', error);
    return false;
  }
}




function safeTabMessage(tabId, message, callback = null) {
  if (!tabId) {
    console.warn('無効なタブIDです');
    if (callback) callback(false);
    return Promise.resolve(false);
  }
  
  return new Promise((resolve) => {
    // タブの存在確認
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        console.log(`タブ${tabId}は存在しません:`, chrome.runtime.lastError.message);
        if (callback) callback(false);
        resolve(false);
        return;
      }
      
      // メッセージ送信
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          console.log(`タブ${tabId}への送信失敗:`, chrome.runtime.lastError.message);
          if (callback) callback(false);
          resolve(false);
        } else {
          if (callback) callback(response);
          resolve(response);
        }
      });
    });
  });
}


/**
 * アンシャープマスクフィルタを適用して画像をシャープにする
 * 特にテキスト認識に有用
 */
function applyUnsharpMask(data, width, height, amount = 0.6, radius = 0.5, threshold = 0) {
  // これは簡略版 - 完全な実装はもっと複雑
  // 元のデータのコピーを作成
  const result = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i];
  }
  
  // ぼかしとアンシャープマスクを適用
  // 理想的にはガウスぼかしアルゴリズムを使用
  // この例では単純なボックスぼかしを使用
  
  // エッジではない各ピクセルに対して
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      for (let c = 0; c < 3; c++) { // RGBチャンネルのみ
        const idx = (y * width + x) * 4 + c;
        
        // ローカル平均を計算（単純なボックスぼかし）
        const avg = (
          data[idx - width * 4 - 4] + data[idx - width * 4] + data[idx - width * 4 + 4] +
          data[idx - 4] + data[idx] + data[idx + 4] +
          data[idx + width * 4 - 4] + data[idx + width * 4] + data[idx + width * 4 + 4]
        ) / 9;
        
        // 差分を計算
        const diff = data[idx] - avg;
        
        // 差分が閾値を超える場合のみ適用
        if (Math.abs(diff) > threshold) {
          result[idx] = clamp(data[idx] + diff * amount);
        }
      }
    }
  }
  
  return result;
}









/**
 * APIリクエストキューイング機構
 */
class APIRequestQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.lastRequest = 0;
    this.minInterval = 500; // 0.5秒間隔
  }
  
  async execute(requestFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ requestFn, resolve, reject });
      this.processQueue();
    });
  }
  
  async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    const { requestFn, resolve, reject } = this.queue.shift();
    
    try {
      // 最小間隔を確保
      const elapsed = Date.now() - this.lastRequest;
      if (elapsed < this.minInterval) {
        await new Promise(r => setTimeout(r, this.minInterval - elapsed));
      }
      
      const result = await requestFn();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.lastRequest = Date.now();
      this.processing = false;
      // 次のキュー処理を少し遅延させる
      setTimeout(() => this.processQueue(), 50);
    }
  }
  
  getQueueLength() {
    return this.queue.length;
  }
}

// グローバルキューインスタンス
const apiRequestQueue = new APIRequestQueue();

/**
 * 画像データサイズをチェックする関数
 * @param {string} dataUrl - 画像のデータURL
 * @returns {number} - 画像サイズ（MB）
 * @throws {Error} - サイズが制限を超える場合
 */
function checkImageSize(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') {
    throw new Error('無効な画像データです');
  }
  
  // Base64データからサイズを推定（MB単位）
  const base64 = dataUrl.split(',')[1] || '';
  const sizeInMB = (base64.length * 0.75) / (1024 * 1024);
  
  const MAX_SIZE_MB = 15; // 15MBまで（Gemini APIの制限を考慮）
  
  console.log(`画像サイズ: ${sizeInMB.toFixed(2)}MB`);
  
  if (sizeInMB > MAX_SIZE_MB) {
    throw new Error(`画像サイズが大きすぎます（${sizeInMB.toFixed(1)}MB）。${MAX_SIZE_MB}MB以下にしてください。`);
  }
  
  return sizeInMB;
}

/**
 * 画像を自動圧縮する関数
 * @param {string} imageData - 元の画像データ
 * @param {number} targetSizeMB - 目標サイズ（MB）
 * @returns {Promise<string>} - 圧縮された画像データ
 */
async function compressImageToSize(imageData, targetSizeMB = 10) {
  console.log('画像を自動圧縮しています...');
  
  // 段階的に品質を下げて圧縮
  const qualityLevels = [0.8, 0.6, 0.4, 0.3];
  const dimensionLimits = [1400, 1200, 1000, 800];
  
  for (let i = 0; i < qualityLevels.length; i++) {
    try {
      const compressedImage = await optimizeImage(imageData, {
        quality: qualityLevels[i],
        maxDimension: dimensionLimits[i],
        enhanceText: true,
        contrast: 1.1
      });
      
      // 圧縮後のサイズをチェック
      const base64 = compressedImage.split(',')[1] || '';
      const sizeInMB = (base64.length * 0.75) / (1024 * 1024);
      
      console.log(`圧縮レベル${i + 1}: ${sizeInMB.toFixed(2)}MB (品質: ${qualityLevels[i]}, 最大寸法: ${dimensionLimits[i]})`);
      
      if (sizeInMB <= targetSizeMB) {
        console.log('画像圧縮が完了しました');
        return compressedImage;
      }
    } catch (error) {
      console.warn(`圧縮レベル${i + 1}でエラー:`, error);
      continue;
    }
  }
  
  throw new Error('画像サイズを十分に圧縮できませんでした。より小さな領域を選択してください。');
}




class HybridOCRManager {
  constructor() {
    
    this.useLocal = true;
    this.localOCRReady = false;
  }
  

  
  async loadScript(path) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL(path);
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  
  async extractText(imageData, options = {}) {
 
    
    // Gemini APIフォールバック
    console.log('Using Gemini API');
    return await extractTextWithGemini(imageData, options);
  }
  
  getStatus() {
    return {
      localOCRAvailable: this.localOCRReady,
      usingLocal: this.useLocal
    };
  }
}

// グローバルインスタンス作成
const hybridOCRManager = new HybridOCRManager();




async function loadLocalLLMEngine() {
  try {
    // ローカルLLMエンジンスクリプトをロード
    await importScript(chrome.runtime.getURL('lib/local-llm-engine.js'));
    await importScript(chrome.runtime.getURL('lib/enhanced-hybrid-ocr-manager.js'));
    
    // 既存のインスタンスを置き換え
    if (typeof EnhancedHybridOCRManager !== 'undefined') {
      window.hybridOCRManager = new EnhancedHybridOCRManager();
      await window.hybridOCRManager.initialize();
      console.log('Enhanced Hybrid OCR Manager loaded successfully');
    }
  } catch (error) {
    console.warn('ローカルLLMエンジンの読み込みに失敗:', error);
    // 既存のHybridOCRManagerを継続使用
  }
}

// スクリプトの動的インポート関数
function importScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}




/**
 * Gemini APIを使用してテキストを抽出する関数（強化版）
 * @param {string} imageData - Base64エンコードされた画像データ
 * @param {Object} options - 抽出オプション
 * @returns {Promise<Object>} - 抽出結果
 */
async function extractTextWithGemini(imageData, options = {}) {
  // キューイング機構を使用してAPI呼び出しを制御
  return apiRequestQueue.execute(async () => {
    console.log(`APIキュー実行開始 (待機中: ${apiRequestQueue.getQueueLength()}件)`);
    
    // リトライ設定
    const MAX_RETRIES = 1;
    
    // 引数の検証
    if (!imageData || !imageData.startsWith('data:image/')) {
      throw new Error('無効な画像データです');
    }
    
    // 画像サイズチェックと自動圧縮
    let processedImageData = imageData;
    try {
      checkImageSize(imageData);
      console.log('画像サイズチェック: OK');
    } catch (sizeError) {
      if (sizeError.message.includes('画像サイズが大きすぎます')) {
        console.log('画像サイズが大きいため自動圧縮を実行します');
        try {
          processedImageData = await compressImageToSize(imageData, 10);
          // 圧縮後に再度サイズチェック
          checkImageSize(processedImageData);
        } catch (compressionError) {
          throw new Error(`画像圧縮エラー: ${compressionError.message}`);
        }
      } else {
        throw sizeError;
      }
    }
    
    // 設定を取得
    const settings = await loadSettings();
    const apiKey = settings.apiKey;
    const model = options.model || settings.model || 'gemini-2.0-flash';
    
    if (!apiKey) {
      throw new Error('APIキーが設定されていません');
    }
    
    // Base64エンコードされた画像からヘッダー部分を削除
    const base64Image = processedImageData.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');
    
    // 言語や処理モードの設定
    const { language = settings.language, mode = settings.mode, fieldType = null } = options;
    
    // モデル名に基づいてエンドポイントを決定
    const modelEndpoint = model.trim().replace(/\s+/g, '-');
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelEndpoint}:generateContent?key=${apiKey}`;
    
    // モデルごとに最適なプロンプトを取得
    const promptText = getPromptForModel(model, language, mode, fieldType);
    
    // リトライループ
    let attempt = 0;
    let lastError = null;
    
    while (attempt <= MAX_RETRIES) {
      try {
        console.log(`Gemini API呼び出し開始 (試行 ${attempt + 1}/${MAX_RETRIES + 1})`);
        
        // リクエストボディの作成
        const requestBody = {
          contents: [{
            parts: [
              { text: promptText },
              { inline_data: { mime_type: "image/jpeg", data: base64Image } }
            ]
          }],
          generation_config: {
            temperature: 0.05,
            top_p: 0.97,
            response_mime_type: "text/plain"
          }
        };
        
        // APIリクエストを送信（タイムアウト制御付き）
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('APIリクエストがタイムアウトしました')), 15000); // 15秒に延長
        });
        
        const fetchPromise = fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });
        
        // どちらか早い方を採用
        const response = await Promise.race([fetchPromise, timeoutPromise]);
        clearTimeout(timeoutId);
        
        // レスポンスを処理
        if (!response.ok) {
          const errorData = await response.json();
          console.error('Gemini API エラー:', errorData);
          
          let errorMessage = 'APIリクエストに失敗しました';
          
          if (errorData.error && errorData.error.message) {
            errorMessage = errorData.error.message;
          } else if (typeof errorData === 'object') {
            try {
              errorMessage = JSON.stringify(errorData);
            } catch (e) {
              errorMessage = 'APIエラー: 詳細不明';
            }
          }
          
          // レート制限エラーやサーバー負荷エラーの場合はリトライ
          if (
            errorMessage.includes('overloaded') || 
            errorMessage.includes('rate limit') ||
            errorMessage.includes('server error') ||
            errorMessage.includes('try again') ||
            response.status === 429 || 
            response.status >= 500
          ) {
            throw new Error(`一時的なAPI制限: ${errorMessage}`);
          }
          
          throw new Error(`API エラー: ${errorMessage}`);
        }
        
        const data = await response.json();
        
        // レスポンスからテキストを抽出
        if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
          console.log('Gemini API呼び出し成功');
          return {
            text: data.candidates[0].content.parts[0].text,
            confidence: 0.95,
            imageCompressed: processedImageData !== imageData // 圧縮されたかどうか
          };
        } else {
          throw new Error('テキストを抽出できませんでした');
        }
      } catch (error) {
        console.error(`テキスト抽出エラー (リトライ ${attempt + 1}/${MAX_RETRIES + 1}):`, error);
        
        // 一時的なエラーの場合のみリトライ
        const isTemporaryError = error.message && (
          error.message.includes('一時的なAPI制限') || 
          error.message.includes('overloaded') ||
          error.message.includes('rate limit') ||
          error.message.includes('timeout') ||
          error.message.includes('タイムアウト')
        );
        
        if (isTemporaryError && attempt < MAX_RETRIES) {
          lastError = error;
          attempt++;
          
          // キューイング機構により既に間隔制御されているため、リトライ遅延は短縮
          const retryDelay = 1000 * Math.pow(1.5, attempt - 1);
          console.log(`${retryDelay}ms後にリトライします...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        } else {
          // 一時的でないエラーまたはリトライ回数超過
          throw error;
        }
      }
    }
    
    // すべてのリトライが失敗した場合
    throw new Error(`Gemini APIへのリクエストが失敗しました。最後のエラー: ${lastError ? lastError.message : '不明なエラー'}`);
  });
}

/**
 * モデルごとに適切なプロンプトを返す関数
 * @param {string} model - 使用するモデル名
 * @param {string} language - 言語設定
 * @param {string} mode - OCRモード
 * @param {string} fieldType - フィールドタイプ
 * @returns {string} プロンプトテキスト
 */
function getPromptForModel(model, language, mode, fieldType) {
  // Gemini 2.5 Flash用のプロンプト（最新の最適化版）
  if (model === 'gemini-2.5-flash') {
    if (fieldType === 'phone-number') {
      return `画像に含まれる電話番号を正確に抽出してください。以下の要件に従ってください：
- 数字、ハイフン、カンマのみを返してください（例: 03-1234-5678）
- 複数の電話番号があればカンマで区切って全て抽出してください
- Tで始まる13桁の事業者番号は無視してください
- 国際的な標準形式（+81）も適切に処理してください
- 余計な説明や文字は不要です`;
    } else if (fieldType === 'payee-name') {
      return `画像から以下を抽出してください:
1. 会社名: 法人格(株式会社など)と支店名を除いた正確な名称。ひらがな・カタカナ・漢字などを正確に区別し、複数ある場合はカンマ区切り。
2. 電話番号: ハイフン含む完全な番号。複数ある場合はカンマ区切り。T始まりの13桁事業者番号は除外。

形式:
会社名: [抽出結果]
電話番号: [抽出結果]

画像の解像度が低くても最大限正確に読み取ってください。検出できない項目は空欄にしてください。`;
    } else {
      return `以下の画像に含まれるテキストを抽出してください。言語は${language === 'ja' ? '日本語' : language === 'en' ? '英語' : '複数言語'}です。
${mode === 'accurate' ? '文字の形や特徴を細かく観察し、文脈を考慮して正確に認識してください。特に小さな文字や低コントラストの文字も注意深く認識してください。似た文字（例：「り」と「リ」、「0」と「O」、「l」と「1」など）は文脈から判断して区別してください。' : ''}
レイアウトは無視して純粋なテキストのみを出力してください。`;
    }
  }else if (model === 'gemini-2.0-flash-light') {
    if (fieldType === 'phone-number') {
      return `画像内の電話番号を正確に抽出してください。数字、ハイフン、カンマのみを返してください。例: 03-1234-5678。
複数の電話番号があれば、カンマで区切って全て抽出してください。
余計な説明や文字は不要です。Tで始まる13桁の事業者番号は無視してください。
国際的な標準形式（+81）も適切に処理してください。`;
    } else if (fieldType === 'payee-name') {
      return `画像から以下を抽出してください:
1. 会社名: 法人格(株式会社など)と支店名を除いた正確な名称。ひらがな・カタカナ・漢字などを正確に区別し、複数ある場合はカンマ区切り。
2. 電話番号: ハイフン含む完全な番号。複数ある場合はカンマ区切り。T始まりの13桁事業者番号は除外。

形式:
会社名: [抽出結果]
電話番号: [抽出結果]

画像の解像度が低くても最大限正確に読み取ってください。検出できない項目は空欄にしてください。`;
    } else {
      return `以下の画像に含まれるテキストを抽出してください。言語は${language === 'ja' ? '日本語' : language === 'en' ? '英語' : '複数言語'}です。
文字の形や特徴を細かく観察し、文脈を考慮して正確に認識してください。特に小さな文字や低コントラストの文字も注意深く認識してください。
似た文字（例：「り」と「リ」、「0」と「O」、「l」と「1」など）は文脈から判断して区別してください。
レイアウトは無視して純粋なテキストのみを出力してください。`;
    }
  }
  // Gemini 1.5 Flash用のプロンプト
  else if (model === 'gemini-1.5-flash') {
    if (fieldType === 'phone-number') {
      return `画像内の電話番号を正確に抽出してください。数字、ハイフン、カンマのみを返してください。例: 03-1234-5678。
複数の電話番号があれば、カンマで区切って全て抽出してください。
余計な説明や文字は不要です。Tで始まる13桁の事業者番号は無視してください。
国際的な標準形式（+81）も適切に処理してください。`;
    } else if (fieldType === 'payee-name') {
      return `画像から以下を抽出してください:
1. 会社名: 法人格(株式会社など)と支店名を除いた正確な名称。ひらがな・カタカナ・漢字などを正確に区別し、複数ある場合はカンマ区切り。
2. 電話番号: ハイフン含む完全な番号。複数ある場合はカンマ区切り。T始まりの13桁事業者番号は除外。

形式:
会社名: [抽出結果]
電話番号: [抽出結果]

画像の解像度が低くても最大限正確に読み取ってください。検出できない項目は空欄にしてください。`;
    } else {
      return `以下の画像に含まれるテキストを抽出してください。言語は${language === 'ja' ? '日本語' : language === 'en' ? '英語' : '複数言語'}です。
文字の形や特徴を細かく観察し、文脈を考慮して正確に認識してください。特に小さな文字や低コントラストの文字も注意深く認識してください。
似た文字（例：「り」と「リ」、「0」と「O」、「l」と「1」など）は文脈から判断して区別してください。
レイアウトは無視して純粋なテキストのみを出力してください。`;
    }
  }
  // Gemini 2.0 Flash用のプロンプト
  else if (model === 'gemini-2.0-flash') {
    if (fieldType === 'phone-number') {
      return `画像に含まれる電話番号のみを正確に抽出し、複数候補があるときはカンマで区切り、数字、ハイフン、カンマのみを返してください。例: 03-1234-5678。それ以外の文字や説明は不要です。Tで始まる13桁の事業者番号は無視してください。`;
    } else if (fieldType === 'payee-name') {
      return `画像から以下を抽出してください:
1. 会社名: 法人格(株式会社など)と支店名を除いた正確な名称。ひらがな・カタカナ・漢字などを正確に区別し、複数ある場合はカンマ区切り。
2. 電話番号: ハイフン含む完全な番号。複数ある場合はカンマ区切り。T始まりの13桁事業者番号は除外。

形式:
会社名: [抽出結果]
電話番号: [抽出結果]

検出できない項目は空欄にしてください。`;
    } else {
      return `以下の画像に含まれるテキストを抽出してください。言語は${language === 'ja' ? '日本語' : language === 'en' ? '英語' : '複数言語'}です。
${mode === 'accurate' ? '文字の形や特徴を細かく観察し、文脈を考慮して正確に認識してください。特に似た文字（例：「り」と「リ」、「0」と「O」）を区別してください。' : ''}
レイアウトは無視して純粋なテキストのみを出力してください。`;
    }
  }
  // その他のモデルやデフォルトのプロンプト
  else {
    if (fieldType === 'phone-number') {
      return `画像に含まれる電話番号のみを正確に抽出し、複数候補があるときはカンマで区切り、数字、ハイフン、カンマのみを返してください。例: 03-1234-5678。それ以外の文字や説明は不要です。Tで始まる13桁の事業者番号は無視してください。`;
    } else if (fieldType === 'payee-name') {
      return `画像から以下を抽出してください:
1. 会社名: 法人格(株式会社など)と支店名を除いた正確な名称。複数ある場合はカンマ区切り。
2. 電話番号: ハイフン含む完全な番号。複数ある場合はカンマ区切り。T始まりの13桁事業者番号は除外。

形式:
会社名: [抽出結果]
電話番号: [抽出結果]

検出できない項目は空欄にしてください。`;
    } else {
      return `以下の画像に含まれるテキストを抽出してください。言語は${language === 'ja' ? '日本語' : language === 'en' ? '英語' : '複数言語'}です。
${mode === 'accurate' ? '文字の形や特徴を細かく観察し、文脈を考慮して正確に認識してください。特に似た文字（例：「り」と「リ」、「0」と「O」）を区別してください。' : ''}
純粋に認識されたテキストのみを出力し、余計な説明は不要です。`;
    }
  }
}
/**
 * エラーハンドリングの改善
 */
function getReadableErrorMessage(error) {
  if (!error) return 'エラーが発生しました';
  
  const errorMessage = error.message || error.toString();
  
  // Service Worker関連のエラー
  if (errorMessage.includes('Could not establish connection')) {
    return 'Service Workerとの接続に失敗しました。拡張機能を再読み込みしてください。';
  }
  
  if (errorMessage.includes('Receiving end does not exist')) {
    return 'Background scriptが応答しません。拡張機能を再読み込みするか、ブラウザを再起動してください。';
  }
  
  if (errorMessage.includes('Extension context invalidated')) {
    return '拡張機能のコンテキストが無効になりました。ページを再読み込みしてください。';
  }
  
  // API関連のエラー
  if (errorMessage.includes('overloaded') || errorMessage.includes('一時的なAPI制限')) {
    return 'Google Gemini APIが混雑しています。しばらく待ってから再試行してください。';
  }
  
  if (errorMessage.includes('rate limit')) {
    return 'APIの利用制限に達しました。しばらく待ってから再試行してください。';
  }
  
  if (errorMessage.includes('invalid API key') || errorMessage.includes('APIキーが設定されていません')) {
    return 'APIキーが無効です。設定から正しいGemini APIキーを入力してください。';
  }
  
  // ネットワーク関連のエラー
  if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
    return 'ネットワークエラーが発生しました。インターネット接続を確認してください。';
  }
  
  // Content Script関連のエラー
  if (errorMessage.includes('Content script')) {
    return 'Content scriptとの通信に失敗しました。ページを再読み込みしてください。';
  }
  
  // タブ関連のエラー
  if (errorMessage.includes('アクティブなタブが見つかりません')) {
    return 'アクティブなタブが見つかりません。ブラウザでWebページを開いてから再試行してください。';
  }
  
  // デフォルトのエラーメッセージ
  return `エラー: ${errorMessage}`;
}


// NGワードリストを定義
const ngWordsList = [
  "株式会社", "有限会社", "合同会社", "合資会社", "合名会社",
  "医療法人", "医療法人社団", "医療法人財団", "社会医療法人",
  "宗教法人", "学校法人", "社会福祉法人", "更生保護法人", "相互会社",
  "特定非営利活動法人", "独立行政法人", "地方独立行政法人", "弁護士法人",
  "有限責任中間法人", "無限責任中間法人", "行政書士法人", "司法書士法人",
  "税理士法人", "国立大学法人", "公立大学法人", "農事組合法人", "管理組合法人",
  "社会保険労務士法人", "一般社団法人", "公益社団法人", "一般財団法人",
  "公益財団法人", "非営利法人", "(株)", "(有)", "支店"
];

// 正規表現パターンを生成（一度だけ計算して再利用するため）
const ngWordsPattern = new RegExp(
  ngWordsList.map(word => escapeRegExp(word)).join('|'),
  'g'
);

// 正規表現のメタ文字をエスケープする補助関数
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}








// OCR結果の後処理を行う関数（フィールドタイプ別）
function postProcessOcrResult(text, fieldType) {
  if (!text) return text;
  
  // Normalize text
  text = text.normalize('NFC').trim();
  
  // 全角英数字を半角に変換
  text = text.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function(s) {
    return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);  // 全角英数字を半角に変換
  });
  
  // 記号類を半角に変換（中点と全角ピリオド）
  text = text.replace(/[・．]/g, function(s) {
    if (s === '・') return '･';  // 全角中点を半角中点に変換
    if (s === '．') return '.';  // 全角ピリオドを半角ピリオドに変換
    return s;
  });

  // 半角カタカナを全角カタカナに変換（より詳細な変換）
  const halfToFullKatakanaMap = {
    'ｱ': 'ア', 'ｲ': 'イ', 'ｳ': 'ウ', 'ｴ': 'エ', 'ｵ': 'オ',
    'ｶ': 'カ', 'ｷ': 'キ', 'ｸ': 'ク', 'ｹ': 'ケ', 'ｺ': 'コ',
    'ｻ': 'サ', 'ｼ': 'シ', 'ｽ': 'ス', 'ｾ': 'セ', 'ｿ': 'ソ',
    'ﾀ': 'タ', 'ﾁ': 'チ', 'ﾂ': 'ツ', 'ﾃ': 'テ', 'ﾄ': 'ト',
    'ﾅ': 'ナ', 'ﾆ': 'ニ', 'ﾇ': 'ヌ', 'ﾈ': 'ネ', 'ﾉ': 'ノ',
    'ﾊ': 'ハ', 'ﾋ': 'ヒ', 'ﾌ': 'フ', 'ﾍ': 'ヘ', 'ﾎ': 'ホ',
    'ﾏ': 'マ', 'ﾐ': 'ミ', 'ﾑ': 'ム', 'ﾒ': 'メ', 'ﾓ': 'モ',
    'ﾔ': 'ヤ', 'ﾕ': 'ユ', 'ﾖ': 'ヨ',
    'ﾗ': 'ラ', 'ﾘ': 'リ', 'ﾙ': 'ル', 'ﾚ': 'レ', 'ﾛ': 'ロ',
    'ﾜ': 'ワ', 'ｦ': 'ヲ', 'ﾝ': 'ン',
    'ｧ': 'ァ', 'ｨ': 'ィ', 'ｩ': 'ゥ', 'ｪ': 'ェ', 'ｫ': 'ォ',
    'ｯ': 'ッ', 'ｬ': 'ャ', 'ｭ': 'ュ', 'ｮ': 'ョ',
    'ｰ': 'ー', /* 中点エントリを削除 */ 'ﾞ': '゛', 'ﾟ': '゜'
  };
  
  // 濁点・半濁点の特別処理
  text = text.replace(/([ｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾊﾋﾌﾍﾎ])ﾞ/g, function(match, p1) {
    const base = halfToFullKatakanaMap[p1];
    const dakutenMap = {
      'カ': 'ガ', 'キ': 'ギ', 'ク': 'グ', 'ケ': 'ゲ', 'コ': 'ゴ',
      'サ': 'ザ', 'シ': 'ジ', 'ス': 'ズ', 'セ': 'ゼ', 'ソ': 'ゾ',
      'タ': 'ダ', 'チ': 'ヂ', 'ツ': 'ヅ', 'テ': 'デ', 'ト': 'ド',
      'ハ': 'バ', 'ヒ': 'ビ', 'フ': 'ブ', 'ヘ': 'ベ', 'ホ': 'ボ'
    };
    return dakutenMap[base] || (base + '゛');
  });
  
  text = text.replace(/([ﾊﾋﾌﾍﾎ])ﾟ/g, function(match, p1) {
    const base = halfToFullKatakanaMap[p1];
    const handakutenMap = {
      'ハ': 'パ', 'ヒ': 'ピ', 'フ': 'プ', 'ヘ': 'ペ', 'ホ': 'ポ'
    };
    return handakutenMap[base] || (base + '゜');
  });
  
  // 残りの半角カタカナを全角に変換
  text = text.replace(/[ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝｧｨｩｪｫｯｬｭｮｰ]/g, function(s) {
    return halfToFullKatakanaMap[s] || s;
  });
  
  // 支払先名の場合、NGワードを除外
  if (fieldType === 'payee-name') {
    // NGワードを除外
    text = removeNgWords(text);
  }

  switch (fieldType) {
    case 'phone-number':
      // 複数の電話番号を含む場合、カンマで区切られたまま返す
      if (text.includes(',') || text.includes('、')) {
        // Split by comma, process each number, then rejoin
        const numbers = text.split(/[,、]/).map(num => {
          let cleaned = num.trim().replace(/[^\d\-+]/g, '');
          return formatPhoneNumber(cleaned);
        });
        
        // カンマで区切って返す（これがコンテンツスクリプトのfillTextFieldに渡される）
        return numbers.join(',');
      } else {
        // 単一の電話番号の場合
        text = text.replace(/[^\d\-+]/g, '');
        return formatPhoneNumber(text);
      }
    case 'payee-name':
      // Clean up extra spaces and symbols
      text = text.replace(/\s+/g, ' ').trim();
      break;
      
    case 'phonetic':
      // Convert katakana to hiragana
      text = text.replace(/[\u30A1-\u30FA]/g, function(match) {
        return String.fromCharCode(match.charCodeAt(0) - 0x60);
      });
      break;
      
    case 'clipboard':
      // No special processing for clipboard
      break;
  }
  
  return text;
}


/**
 * NGワードをテキストから除外する関数
 * @param {string} text - 処理するテキスト
 * @returns {string} - NGワードが除外されたテキスト
 */
function removeNgWords(text) {
  // ステップ1: 単純に正規表現で一括置換
  let processedText = text.replace(ngWordsPattern, '');
  
  // ステップ2: カンマ区切りのケースを処理
  if (processedText.includes(',') || processedText.includes('、')) {
    const items = processedText.split(/[,、]/).map(item => {
      // 各項目からNGワードを除去して空白も整理
      return item.trim().replace(/\s+/g, ' ');
    }).filter(item => item.length > 0); // 空の項目を削除
    
    processedText = items.join(',');
  }
  
  // 前後の空白を削除
  processedText = processedText.trim();
  
  // "会社名: " のようなラベルの後に何も残らない場合の処理
  processedText = processedText.replace(/会社名:\s*$/i, '');
  
  // コロン+空白が残っている場合は削除
  processedText = processedText.replace(/:\s*$/g, '');
  
  return processedText;
}


// Helper function to format phone numbers
function formatPhoneNumber(digits) {

  // 入力の検証を追加
  if (!digits) return '';
  
  // 桁数チェックを追加
  const digitsOnly = digits.replace(/[^\d]/g, '');
  if (digitsOnly.length > 11) {
    console.warn('電話番号の桁数が多すぎます:', digitsOnly.length, '桁');
    return '';  // 無効な電話番号は空文字を返す
  }

  // If already contains hyphens, first check if the format is valid
  if (digits.includes('-')) {
    // If it matches a valid format with hyphens, return as is
    if (/^\d{2,4}-\d{2,4}-\d{4}$/.test(digits)) {
      return digits;
    }
    // Otherwise remove hyphens for reformatting
    digits = digits.replace(/-/g, '');
  }
  
  // Ensure we only have digits at this point
  digits = digits.replace(/[^\d]/g, '');
  
  // Format based on length
  if (/^\d{10,11}$/.test(digits)) {
    if (digits.length === 10) {
      // 10-digit number processing
      if (digits.startsWith('03')) {
        // Tokyo numbers starting with 03
        return digits.replace(/^(\d{2})(\d{4})(\d{4})$/, '$1-$2-$3');
      } else if (digits.startsWith('06')) {
        // Osaka numbers starting with 06
        return digits.replace(/^(\d{2})(\d{4})(\d{4})$/, '$1-$2-$3');
      } else if (digits.startsWith('04')) {
        // other numbers starting with 04
        return digits.replace(/^(\d{2})(\d{4})(\d{4})$/, '$1-$2-$3');
      } else if (digits.startsWith('052') || digits.startsWith('072') || digits.startsWith('075') || 
                digits.startsWith('078') || digits.startsWith('082') || digits.startsWith('092')) {
        // 3-digit area codes (Nagoya, Osaka-area, Kyoto, Kobe, Hiroshima, Fukuoka)
        return digits.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
      } else if (digits.startsWith('0120')) {
        // free dial
        return digits.replace(/^(\d{4})(\d{2})(\d{4})$/, '$1-$2-$3');
      } else if (digits.startsWith('0')) {
        // Other land-line numbers - try to guess area code length
        // If starts with 04, 05, 07, 08, 09 likely 3-digit area code
        if (/^0[4-9]/.test(digits)) {
          return digits.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
        } else {
          // Default to 2-digit area code
          return digits.replace(/^(\d{2})(\d{4})(\d{4})$/, '$1-$2-$3');
        }
      } else {
        // If no area code pattern recognized, just format as 3-3-4
        return digits.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
      }
    } else if (digits.length === 11) {
      // Mobile phones (11 digits) or IP phones
      if (digits.startsWith('0')) {
        return digits.replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3');
      } else {
        // Non-standard 11-digit format
        return digits.replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3');
      }
    }
  } else if (digits.length === 8) {
    // Local call only - no area code (8 digits)
    return digits.replace(/^(\d{4})(\d{4})$/, '$1-$2');
  } else if (digits.length === 9) {
    // Some unusual 9-digit numbers
    return digits.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1-$2-$3');
  }
  // If format doesn't match known patterns, return digits without changes
  return digits;
}


/**
 * エラーハンドリングの改善
 */
function getReadableErrorMessage(error) {
  if (!error) return 'エラーが発生しました';
  
  const errorMessage = error.message || error.toString();
  
  // Service Worker関連のエラー
  if (errorMessage.includes('Could not establish connection')) {
    return 'Service Workerとの接続に失敗しました。拡張機能を再読み込みしてください。';
  }
  
  if (errorMessage.includes('Receiving end does not exist')) {
    return 'Background scriptが応答しません。拡張機能を再読み込みするか、ブラウザを再起動してください。';
  }
  
  if (errorMessage.includes('Extension context invalidated')) {
    return '拡張機能のコンテキストが無効になりました。ページを再読み込みしてください。';
  }
  
  // API関連のエラー
  if (errorMessage.includes('overloaded') || errorMessage.includes('一時的なAPI制限')) {
    return 'Google Gemini APIが混雑しています。しばらく待ってから再試行してください。';
  }
  
  if (errorMessage.includes('rate limit')) {
    return 'APIの利用制限に達しました。しばらく待ってから再試行してください。';
  }
  
  if (errorMessage.includes('invalid API key') || errorMessage.includes('APIキーが設定されていません')) {
    return 'APIキーが無効です。設定から正しいGemini APIキーを入力してください。';
  }
  
  // ネットワーク関連のエラー
  if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
    return 'ネットワークエラーが発生しました。インターネット接続を確認してください。';
  }
  
  // Content Script関連のエラー
  if (errorMessage.includes('Content script')) {
    return 'Content scriptとの通信に失敗しました。ページを再読み込みしてください。';
  }
  
  // タブ関連のエラー
  if (errorMessage.includes('アクティブなタブが見つかりません')) {
    return 'アクティブなタブが見つかりません。ブラウザでWebページを開いてから再試行してください。';
  }
  
  // デフォルトのエラーメッセージ
  return `エラー: ${errorMessage}`;
}

/**
 * Content Scriptが存在することを確認する関数の改善版
 */
function ensureContentScriptLoaded(tabId) {
  return new Promise((resolve, reject) => {
    if (!tabId) {
      reject(new Error('無効なタブIDです'));
      return;
    }
    
    // まず、Content scriptがすでに読み込まれているか確認
    chrome.tabs.sendMessage(tabId, { action: "ping" }, function(response) {
      if (chrome.runtime.lastError) {
        console.log(`タブ ${tabId}: Content scriptが見つかりません。注入を開始します...`);
        
        // Content scriptを動的に挿入
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ["content.js"]
        }).then(() => {
          console.log(`タブ ${tabId}: Content scriptが正常に注入されました`);
          
          // 注入後にもう一度pingを送信して確認
          setTimeout(() => {
            chrome.tabs.sendMessage(tabId, { action: "ping" }, function(response) {
              if (chrome.runtime.lastError) {
                console.error(`タブ ${tabId}: Content script注入後も応答なし:`, chrome.runtime.lastError.message);
                reject(new Error('Content scriptの注入に失敗しました'));
              } else {
                console.log(`タブ ${tabId}: Content scriptが応答しました`);
                resolve(true);
              }
            });
          }, 1000); // 1秒待機
          
        }).catch(err => {
          console.error(`タブ ${tabId}: スクリプト注入エラー:`, err);
          reject(err);
        });
      } else {
        console.log(`タブ ${tabId}: Content scriptは既に読み込まれています`);
        resolve(true);
      }
    });
  });
}

/**
 * Service Worker の再初期化検出と対応
 */
let isReInitializing = false;

chrome.runtime.onConnect.addListener((port) => {
  console.log('Port connected:', port.name);
  
  port.onDisconnect.addListener(() => {
    console.log('Port disconnected:', port.name);
    
    if (!isReInitializing) {
      isReInitializing = true;
      console.log('Service Worker re-initialization detected');
      
      // 再初期化処理
      setTimeout(() => {
        startKeepAlive();
        isReInitializing = false;
        console.log('Service Worker re-initialization completed');
      }, 1000);
    }
  });
});

/**
 * ストレージ変更の監視
 */
chrome.storage.onChanged.addListener((changes, namespace) => {
  console.log('Storage changed:', namespace, Object.keys(changes));
  
  // 設定変更時にキャッシュをクリア
  if (namespace === 'local') {
    if (changes.geminiApiKey || changes.ocrLanguage || changes.ocrMode || changes.geminiModel) {
      console.log('OCR設定が変更されました。キャッシュをクリアします。');
      cachedSettings.lastUpdate = 0; // キャッシュ無効化
      
      if (imageCache && imageCache.size > 0) {
        imageCache.clear();
        console.log('画像処理キャッシュをクリアしました');
      }
    }
  }
});

/**
 * エラー発生時の自動復旧機能
 */
let errorCount = 0;
const MAX_ERRORS = 5;
const ERROR_RESET_TIME = 5 * 60 * 1000; // 5分

function handleCriticalError(error) {
  errorCount++;
  console.error(`Critical error #${errorCount}:`, error);
  
  if (errorCount >= MAX_ERRORS) {
    console.log('エラー回数が上限に達しました。自動復旧を開始します...');
    
    // Service Workerの再初期化
    try {
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
      
      // キャッシュクリア
      if (imageCache) {
        imageCache.clear();
      }
      
      // 処理状態のリセット
      activeProcessing.clear();
      currentProcessingTabId = null;
      
      // 設定キャッシュのリセット
      cachedSettings.lastUpdate = 0;
      
      setTimeout(() => {
        startKeepAlive();
        errorCount = 0;
        console.log('自動復旧が完了しました');
      }, 2000);
      
    } catch (recoveryError) {
      console.error('自動復旧中にエラー:', recoveryError);
    }
  }
  
  // エラーカウントのリセット
  setTimeout(() => {
    if (errorCount > 0) {
      errorCount = Math.max(0, errorCount - 1);
    }
  }, ERROR_RESET_TIME);
}

// グローバルエラーハンドラーの設定
self.addEventListener('error', (event) => {
  console.error('Service Worker uncaught error:', event.error);
  handleCriticalError(event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Service Worker unhandled promise rejection:', event.reason);
  handleCriticalError(new Error(event.reason));
});

console.log('Enhanced Background Script loaded with Service Worker stability improvements');


function parseMultiFieldResult(text) {
  const result = {
    'payee-name': '',
    'phone-number': ''
  };
  
  console.log('OCR結果の解析開始:', text);
  
  // 正規表現で各フィールドの値を抽出
  const companyMatch = text.match(/会社名:[\s　]*(.*?)(?:\n|$)/i);
  const phoneMatch = text.match(/電話番号:[\s　]*(.*?)(?:\n|$)/i);
  
  // 抽出した値を取得
  let companyName = companyMatch && companyMatch[1] ? companyMatch[1].trim() : '';
  let phoneNumber = phoneMatch && phoneMatch[1] ? phoneMatch[1].trim() : '';
  
  // 重要: 抽出後に半角変換を適用
  companyName = postProcessOcrResult(companyName, 'payee-name');
  phoneNumber = postProcessOcrResult(phoneNumber, 'phone-number');
  
  // 会社名から電話番号に関する文字列を除外


  if (companyName.match(/^\s*電話番号:?\s*$/i)) {
    companyName = ''; // "電話番号:" のような文字列を空にする
  }
  if (phoneNumber.match(/^\s*会社名:?\s*$/i)) {
    phoneNumber = ''; // "会社名:" のような文字列を空にする
  }

  if (companyName) {
    // 複数候補がある場合
    if (companyName.includes(',') || companyName.includes('、')) {
      // カンマで分割して処理、ただし複数候補として保持
      const companyNames = companyName.split(/[,、]/)
        .map(name => name.trim())
        .filter(name => {
          return name && 
                 !name.match(/^\s*電話番号:?/i) && 
                 !name.match(/^tel:?/i) && 
                 !name.match(/^phone:?/i) &&
                 !name.match(/^\d[\d\-\s\(\)]*$/);
        });
      
      // 複数候補をカンマ区切りで保持
      if (companyNames.length > 0) {
        companyName = companyNames.join(',');
      } else {
        companyName = '';
      }
    }
  }
  
  // 電話番号からも会社名に関する文字列を除外（念のため）
  if (phoneNumber) {
    // 電話番号から「会社名:」を除外
    if (phoneNumber.match(/^\s*会社名:?/i)) {
      phoneNumber = '';
    }
  }
  
  console.log('抽出された会社名（フィルタリング後）:', companyName);
  console.log('抽出された電話番号（フィルタリング後）:', phoneNumber);
  
  // 値を設定
  result['payee-name'] = companyName;
  result['phone-number'] = phoneNumber;
  
  console.log('最終解析結果:', result);
  return result;
}




/**
 * キャッシュキーの生成
 */
async function generateCacheKey(imageData, options) {
  // 単純化のためimageDataの先頭部分とオプションからハッシュを生成
  const sampleData = imageData.substring(0, 100) + JSON.stringify(options);
  
  // SHA-256ハッシュの生成
  const encoder = new TextEncoder();
  const data = encoder.encode(sampleData);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  
  // バッファを16進文字列に変換
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
/**
 * キャッシュサイズの制限
 */
function limitCacheSize(maxEntries = 20) {
  if (imageCache.size <= maxEntries) return;
  
  // 最も古いエントリーから削除
  const keysIterator = imageCache.keys();
  for (let i = 0; i < imageCache.size - maxEntries; i++) {
    const key = keysIterator.next().value;
    imageCache.delete(key);
  }
}

// メモリキャッシュの実装
const imageProcessingCache = {
  cache: new Map(),
  async get(imageData, options) {
    const key = await generateCacheKey(imageData, options);
    return this.cache.get(key);
  },
  async set(imageData, result, options) {
    const key = await generateCacheKey(imageData, options);
    this.cache.set(key, result);
    
    // キャッシュサイズの制限（30件まで）
    if (this.cache.size > 30) {
      // 最も古いキーを削除
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
  }
};






/**
 * 画像処理の統合ハンドラ
 */
async function handleImageProcessing(request, tabId) {
  try {
    // 画像データの検証
    if (!request.imageData || !request.imageData.startsWith('data:image/')) {
      throw new Error("無効な画像データです");
    }
    
    // 設定を読み込み
    const settings = await loadSettings();
    
    // キャッシュの確認
    const cacheKey = await cacheKeySimple(request.imageData, request.field);
    const cachedResult = imageCache.get(cacheKey);
    
    if (cachedResult) {
      console.log("キャッシュから結果を取得");
      return {success: true, text: cachedResult};
    }
    
    // 処理中通知を送信
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        action: "showProcessing",
        message: "画像を最適化してOCR処理中..."
      });
    }
    
    // 新しい関数を使用して画像処理とOCR
    const ocrResult = await processImageForOCR(request.imageData, {
      language: settings.language || 'ja',
      mode: settings.mode || 'accurate',
      fieldType: request.field || null
    });
    
    // テキスト後処理
    const processedText = postProcessOcrResult(ocrResult.text, request.field);
    
    // 結果をキャッシュに保存
    imageCache.set(cacheKey, processedText);
    
    // 簡易的なキャッシュ制限
    if (imageCache.size > 30) {
      const oldestKey = imageCache.keys().next().value;
      imageCache.delete(oldestKey);
    }
    
    // 処理中通知を非表示
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        action: "hideProcessing"
      });
    }
    
    // 成功結果を返す
    return {success: true, text: processedText};
  } catch (error) {
    // エラー処理
    console.error("画像処理エラー:", error);
    
    // 処理中通知を非表示にし、エラーを表示
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        action: "hideProcessing"
      });
      
      chrome.tabs.sendMessage(tabId, {
        action: "showError",
        error: getReadableErrorMessage(error)
      });
    }
    
    throw error;
  }
}



  async function cacheKeySimple(imageData, fieldType) {
     const settings = await loadSettings();
     const sampleData = imageData.substring(0, 100) + 
                    (fieldType || '') + 
                    settings.language + 
                    settings.mode + 
                    settings.model;  // ← 設定を含める
  
  // SHA-256ハッシュの生成
  const encoder = new TextEncoder();
  const data = encoder.encode(sampleData);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  
  // バッファを16進文字列に変換
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}











/**
 * 統合された画像前処理関数 - 重複コードを削除し効率化
 * @param {string} imageData - Base64エンコードされた画像データ
 * @param {Object} options - 処理オプション
 * @returns {Promise<string>} - 最適化された画像データ
 */
async function optimizeImage(imageData, options = {}) {
  try {
    // 画像データの検証
    if (!imageData || typeof imageData !== 'string' || !imageData.startsWith('data:image/')) {
      return imageData; // 無効な場合は元の画像を返す
    }
    
    // Base64 → Blob → 画像オブジェクト
    const blob = await fetch(imageData).then(res => res.blob());
    const img = await createImageBitmap(blob);
    
    // 回転情報を取得
    const rotation = options.rotation || 0;
    const isQuarterRotated = options.isQuarterRotated || Math.abs(rotation % 180) === 90;
    
    // リサイズの必要性を判断
    const MAX_DIMENSION = options.maxDimension || 1600;
    let targetWidth = img.width;
    let targetHeight = img.height;
    
    // 90度回転している場合は幅と高さを入れ替えて考慮
    if (isQuarterRotated) {
      // 幅と高さを入れ替えて最大サイズをチェック
      if (targetHeight > MAX_DIMENSION || targetWidth > MAX_DIMENSION) {
        if (targetHeight > targetWidth) {
          targetWidth = Math.round(targetWidth * (MAX_DIMENSION / targetHeight));
          targetHeight = MAX_DIMENSION;
        } else {
          targetHeight = Math.round(targetHeight * (MAX_DIMENSION / targetWidth));
          targetWidth = MAX_DIMENSION;
        }
      }
    } else {
      // 通常の最大サイズチェック
      if (targetWidth > MAX_DIMENSION || targetHeight > MAX_DIMENSION) {
        if (targetWidth > targetHeight) {
          targetHeight = Math.round(targetHeight * (MAX_DIMENSION / targetWidth));
          targetWidth = MAX_DIMENSION;
        } else {
          targetWidth = Math.round(targetWidth * (MAX_DIMENSION / targetHeight));
          targetHeight = MAX_DIMENSION;
        }
      }
    }
    
    // キャンバスを作成し、回転を考慮したサイズに設定
    const canvas = new OffscreenCanvas(
      isQuarterRotated ? targetHeight : targetWidth,
      isQuarterRotated ? targetWidth : targetHeight
    );
    const ctx = canvas.getContext('2d');
    
    // 回転が必要な場合
    if (rotation !== 0) {
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      
      if (isQuarterRotated) {
        // 90度/270度回転の場合
        ctx.drawImage(
          img,
          -targetWidth / 2,  // 回転時は幅と高さが入れ替わる
          -targetHeight / 2, // 回転時は幅と高さが入れ替わる
          targetWidth,
          targetHeight
        );
      } else {
        // 0度/180度回転の場合
        ctx.drawImage(
          img,
          -targetWidth / 2,
          -targetHeight / 2,
          targetWidth,
          targetHeight
        );
      }
      ctx.restore();
    } else {
      // 回転なしの場合は通常描画
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }
    
// 必要な場合のみ画像処理を適用
if ((options.enhanceText || options.contrast) && canvas.width * canvas.height < 300000) {  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  if (options.contrast) {
    const factor = options.contrast || 1.15;
    for (let i = 0; i < data.length; i += 4) {
      for (let j = 0; j < 3; j++) {
        data[i + j] = Math.max(0, Math.min(255, Math.round((data[i + j] - 128) * factor + 128)));
      }
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
}
    
    // 最適な品質を決定
    const quality = typeof options.quality === 'number' ? 
      options.quality : 
      (canvas.width * canvas.height > 800000 ? 0.88 : 0.95);
    
    // BlobからデータURLに変換
    const resultBlob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality: quality
    });
    
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(resultBlob);
    });
  } catch (error) {
    console.error('画像最適化エラー:', error);
    return imageData; // エラー時は元の画像を返す
  }
}

/**
 * 画像コントラストの強調
 * @param {Uint8ClampedArray} data - 画像ピクセルデータ
 * @param {number} factor - コントラスト係数
 */
function enhanceContrast(data, factor = 1.2) {
  for (let i = 0; i < data.length; i += 4) {
    // RGB各チャンネルを処理
    for (let j = 0; j < 3; j++) {
      const val = data[i + j];
      // コントラスト調整式
      data[i + j] = clamp((val - 128) * factor + 128);
    }
  }
}
/**
 * テキスト認識向けの画像強調処理 - 単純化版
 * @param {Uint8ClampedArray} data - 画像ピクセルデータ
 */
function enhanceTextVisibility(data) {
  // エッジを強調
  const width = Math.sqrt(data.length / 4);
  const height = width;
  
  // 簡易シャープニング（エッジ強調）
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      
      // 中央ピクセルの輝度を計算
      const centerLuma = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      
      // 周辺ピクセルの平均輝度を計算
      const surroundingIdx = [
        ((y - 1) * width + x) * 4,
        ((y + 1) * width + x) * 4,
        (y * width + (x - 1)) * 4,
        (y * width + (x + 1)) * 4
      ];
      
      let surroundingLuma = 0;
      for (const sIdx of surroundingIdx) {
        surroundingLuma += (data[sIdx] + data[sIdx + 1] + data[sIdx + 2]) / 3;
      }
      surroundingLuma /= 4;
      
      // エッジ検出（輝度差）
      const diff = centerLuma - surroundingLuma;
      const enhancement = 0.5; // エッジ強調度合い
      
      // エッジを強調
      for (let c = 0; c < 3; c++) {
        data[idx + c] = clamp(data[idx + c] + diff * enhancement);
      }
    }
  }
}

/**
 * 値を0-255の範囲に収める
 * @param {number} value - 入力値
 * @returns {number} - 0-255に収められた値
 */
function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}


/**
 * データサイズに基づいて最適な画質を決定
 * @param {boolean} isLargeImage - 大きな画像かどうか
 * @param {number} baseQuality - 基本品質設定
 * @returns {number} - 最適な品質設定（0.0-1.0）
 */
function determineOptimalQuality(isLargeImage, baseQuality) {
  // ベース品質がある場合はそれを使用
  if (typeof baseQuality === 'number') {
    return baseQuality;
  }
  
  // 大きな画像は低い品質、小さな画像は高い品質
  return isLargeImage ? 0.85 : 0.92;
}

/**
 * データURLのサイズを推定（MB単位）
 * @param {string} dataUrl - 画像のデータURL
 * @returns {number} - 推定サイズ（MB）
 */
function getDataSize(dataUrl) {
  if (!dataUrl) return 0;
  const base64 = dataUrl.split(',')[1] || '';
  // Base64から元のバイト数を推定（Base64は4:3の比率）
  return (base64.length * 0.75) / (1024 * 1024);
}

/**
 * データURLから画像オブジェクトを作成
 * @param {string} dataUrl - 画像のデータURL
 * @returns {Promise<ImageBitmap>} - 画像オブジェクト
 */
async function createImageFromDataURL(dataUrl) {
  // Base64からBlobに変換
  const byteString = atob(dataUrl.split(',')[1]);
  const mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  
  const blob = new Blob([ab], { type: mimeString });
  
  // Blobから画像を作成
  return await createImageBitmap(blob);
}


/**
 * BlobをデータURLに変換
 * @param {Blob} blob - Blobオブジェクト
 * @returns {Promise<string>} - データURL
 */
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}


/**
 * 画像を処理してOCRを実行
 * @param {string} imageData - 画像データ
 * @param {Object} options - 処理オプション
 * @returns {Promise<Object>} - OCR結果
 */
async function processImageForOCR(imageData, options = {}) {
  try {
    const optimizedImage = await optimizeImage(imageData, {
      maxDimension: options.maxDimension || 1600,
      enhanceText: options.mode === 'accurate',
      contrast: options.mode === 'accurate' ? 1.3 : 1.1,
      quality: options.quality,
      rotation: options.rotation,
      isQuarterRotated: options.isQuarterRotated
    });
    
    // ハイブリッドOCRマネージャーを使用
    const ocrResult = await hybridOCRManager.extractText(optimizedImage, {
      language: options.language || 'ja',
      mode: options.mode || 'accurate',
      fieldType: options.fieldType
    });
    
    if (!ocrResult.text || ocrResult.text.trim() === '') {
      let errorMessage = "";
      if (options.fieldType === 'phone-number') {
        errorMessage = "電話番号を認識できませんでした";
      } else if (options.fieldType === 'payee-name') {
        errorMessage = "支払先名を認識できませんでした";
      } else {
        errorMessage = "テキストを認識できませんでした";
      }
      
      const emptyResultError = new Error(errorMessage);
      emptyResultError.code = 'EMPTY_RESULT';
      throw emptyResultError;
    }
    
    return ocrResult;
  } catch (error) {
    console.error('OCR処理エラー:', error);
    throw error;
  }
}












// 画像処理キャッシュ
const imageCache = new Map();




// Service Worker の生存確認とキープアライブ
let keepAliveInterval = null;

/**
 * Service Worker のキープアライブ機能
 */
function startKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
  }
  
  // 25秒ごとにダミー処理を実行してService Workerを生存させる
  keepAliveInterval = setInterval(() => {
    console.log('Service Worker keep-alive ping');
    // 軽量な処理でService Workerを生存させる
    chrome.storage.local.get(['keepAlive'], () => {
      if (chrome.runtime.lastError) {
        console.warn('Keep-alive ping failed:', chrome.runtime.lastError);
      }
    });
  }, 25000); // 25秒間隔
}

/**
 * Service Worker起動時の初期化
 */
chrome.runtime.onStartup.addListener(() => {
  console.log('Extension startup - Service Worker initialized');
  startKeepAlive();
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed/updated - Service Worker initialized');
  startKeepAlive();
});

// Service Worker再開時の処理
self.addEventListener('activate', event => {
  console.log('Service Worker activated');
  startKeepAlive();
});

/**
 * 即座にキープアライブを開始
 */
/*startKeepAlive();
// 既存のmessageHandlers定義の前に以下を追加
if (typeof messageHandlers === 'undefined') {
  var messageHandlers = {};
}
// Ping応答ハンドラーを追加
const originalMessageHandlers = messageHandlers || {};

// Ping応答ハンドラーを既存のmessageHandlersに追加
messageHandlers.ping = function(request, sender) {
  return {
    success: true,
    timestamp: Date.now(),
    serviceWorker: 'active'
  };
};

// getVersionInfoハンドラーを既存のmessageHandlersに追加（重複チェック）
if (!messageHandlers.getVersionInfo) {
  messageHandlers.getVersionInfo = function(request, sender) {
    const manifest = chrome.runtime.getManifest();
    return {
      success: true,
      version: manifest.version,
      name: manifest.name,
      serviceWorker: 'active',
      timestamp: Date.now()
    };
  };
}
*/



// メッセージリスナー
// ハンドラーマップ（各アクションを関数に分離）
const messageHandlers = {
    async testOCR(request, sender) {
    // 1. アクティブなタブ取得
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) {
      throw new Error("アクティブなタブが見つかりません");
    }
    const tab = tabs[0];

    // 2. スクリーンショット取得
    const imageData = await new Promise((resolve, reject) => {
      chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png', quality: 90 }, dataUrl => {
       if (chrome.runtime.lastError || !dataUrl) {
          reject(new Error(chrome.runtime.lastError?.message || 'スクリーンショット取得失敗'));
        } else {
          resolve(dataUrl);
        }
      });
    });

    // 3. 設定読み込み
    const settings = await loadSettings();

    // 4. OCR処理
    const startTime = Date.now();
    const ocrResult = await processImageForOCR(imageData, {
      language: settings.language,
      mode: settings.mode
    });

   // 5. 結果を返す
    return {
      success: true,
      method: ocrResult.usedMethod,                  // 'local-llm' or 'gemini-api'
      time: Date.now() - startTime                   // 実処理時間（ms）
   };
  },
  
  async processImage(request, sender) {
    return await handleImageProcessing(request, sender.tab?.id);
  },

  async processFullImage(request, sender) {
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    if (tabs.length === 0) {
      throw new Error("アクティブなタブが見つかりません");
    }
    
    chrome.tabs.sendMessage(tabs[0].id, {action: "processFullImage"});
    return {success: true};
  },  
  
  async getOCRStatus(request, sender) {
    return hybridOCRManager.getStatus();
  },

  cancelProcessing(request, sender) {
    isProcessingCancelled = true;
    return {cancelled: true};
  },

  checkProcessingStatus(request, sender) {
    return {cancelled: isProcessingCancelled};
  },

  async ensureContentScriptLoaded(request, sender) {
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    if (tabs.length === 0) {
      throw new Error("アクティブなタブが見つかりません");
    }
    
    await ensureContentScriptLoaded(tabs[0].id);
    return {success: true};
  },

  streamedDockOcr(request, sender) {
    // 既存のstreamedDockOcrHandler関数をそのまま呼び出し
    return new Promise((resolve, reject) => {
      streamedDockOcrHandler(request, sender, (response) => {
        if (response.success === false) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      });
    });
  },
  
  
  
  
  async initializeLocalLLM(request, sender) {
    try {
      const modelName = request.model || 'Phi-3-mini-4k-instruct-q4f16_1-MLC';
      
      console.log(`ローカルLLM初期化開始: ${modelName}`);
      
      // ===== 修正: 設定を先に保存 =====
      await chrome.storage.local.set({
        'localLLMInitializing': true,
        'localLLMModel': modelName,
        'localLLMInitializationStart': Date.now()
      });
      
      // アクティブなタブを取得
      const tabs = await chrome.tabs.query({active: true, currentWindow: true});
      if (tabs.length === 0) {
        throw new Error('アクティブなタブが見つかりません');
      }
      
      const tabId = tabs[0].id;
      
      // Content scriptを確実に読み込む
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['content.js']
        });
        
        // ローカルLLMエンジンスクリプトも注入
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['lib/local-llm-engine.js']
        });
        
        console.log('必要なスクリプトを注入しました');
        
        // 少し待ってからメッセージを送信
        await new Promise(resolve => setTimeout(resolve, 1000)); // ===== 修正: 1秒待機 =====
        
      } catch (scriptError) {
        console.warn('スクリプト注入エラー:', scriptError);
        // 既に注入済みの可能性があるので続行
      }
      
      // ===== 修正: Content scriptに初期化指示を送信（リトライ機能付き） =====
      let result = null;
      let attempts = 0;
      const maxAttempts = 3;
      
      while (!result && attempts < maxAttempts) {
        attempts++;
        console.log(`初期化試行 ${attempts}/${maxAttempts}`);
        
        try {
          result = await new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tabId, {
              action: 'initializeLocalLLMModel',
              model: modelName
            }, (response) => {
              if (chrome.runtime.lastError) {
                console.warn(`試行${attempts}: メッセージ送信エラー:`, chrome.runtime.lastError.message);
                resolve(null);
              } else {
                resolve(response);
              }
            });
            
            // タイムアウト設定（30秒）
            setTimeout(() => {
              resolve(null);
            }, 30000);
          });
          
          if (result && result.success) {
            break; // 成功したらループを抜ける
          }
          
        } catch (error) {
          console.warn(`試行${attempts}でエラー:`, error);
        }
        
        // 次の試行前に少し待機
        if (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      if (result && result.success) {
        // ===== 修正: 成功時の設定保存 =====
        await chrome.storage.local.set({
          'localLLMInitialized': true,
          'localLLMInitializing': false,
          'localLLMModel': modelName,
          'localLLMLastInitialized': Date.now(),
          'useLocalLLM': true
        });
        
        console.log('ローカルLLM初期化完了、設定を保存しました');
        
        return { 
          success: true, 
          message: `ローカルLLM (${modelName}) が初期化されました`,
          model: modelName
        };
      } else {
        // ===== 修正: 失敗時の設定更新 =====
        await chrome.storage.local.set({
          'localLLMInitialized': false,
          'localLLMInitializing': false,
          'localLLMInitializationError': 'Content script経由の初期化に失敗'
        });
        
        // 部分的な成功として扱う（WebLLMライブラリは読み込まれている可能性）
        console.warn('Content script経由の初期化に失敗、WebLLMライブラリは利用可能の可能性');
        return { 
          success: false, // ===== 修正: false を返して明確にエラーを示す =====
          error: 'ローカルLLMの初期化に失敗しました。ページを再読み込みして再試行してください。'
        };
      }
      
    } catch (error) {
      console.error('ローカルLLM初期化エラー:', error);
      
      // ===== 修正: エラー時の設定クリア =====
      await chrome.storage.local.set({
        'localLLMInitialized': false,
        'localLLMInitializing': false,
        'localLLMInitializationError': error.message
      });
      
      return { success: false, error: error.message };
    }
  },

  // ===== 修正: getOCRStatus ハンドラーの改善 =====
  async getOCRStatus(request, sender) {
    try {
      // ===== 修正: ストレージから初期化状態を確認 =====
      const storageResult = await chrome.storage.local.get([
        'localLLMInitialized', 
        'localLLMModel', 
        'localLLMInitializing',
        'useLocalLLM'
      ]);
      
      console.log('ストレージから取得した状態:', storageResult);
      
      const tabs = await chrome.tabs.query({active: true, currentWindow: true});
      if (tabs.length === 0) {
        // タブがない場合はストレージの情報のみを返す
        return {
          localLLMAvailable: storageResult.localLLMInitialized === true,
          geminiAPIAvailable: true,
          currentPriority: storageResult.localLLMInitialized ? 'ローカルLLM → Gemini API' : 'Gemini API のみ',
          localLLMStatus: {
            status: storageResult.localLLMInitializing ? 'initializing' : 
                   storageResult.localLLMInitialized ? 'initialized' : 'not_initialized',
            model: storageResult.localLLMModel
          }
        };
      }
      
      // アクティブなタブからステータスを取得（ベストエフォート）
      const result = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'getLocalLLMStatus'
        }, (response) => {
          if (chrome.runtime.lastError) {
            resolve(null); // エラー時は null を返す
          } else {
            resolve(response);
          }
        });
        
        // 2秒でタイムアウト
        setTimeout(() => resolve(null), 2000);
      });
      
      // Content scriptからの応答とストレージ情報を組み合わせ
      if (result && result.success) {
        return {
          localLLMAvailable: result.status.initialized || storageResult.localLLMInitialized,
          geminiAPIAvailable: true,
          currentPriority: (result.status.initialized || storageResult.localLLMInitialized) ? 
                          'ローカルLLM → Gemini API' : 'Gemini API のみ',
          localLLMStatus: {
            status: storageResult.localLLMInitializing ? 'initializing' :
                   (result.status.initialized || storageResult.localLLMInitialized) ? 'initialized' : 'not_initialized',
            model: storageResult.localLLMModel || result.status.modelName
          }
        };
      } else {
        // Content scriptが利用できない場合はストレージ情報のみ
        return {
          localLLMAvailable: storageResult.localLLMInitialized === true,
          geminiAPIAvailable: true,
          currentPriority: storageResult.localLLMInitialized ? 'ローカルLLM → Gemini API' : 'Gemini API のみ',
          localLLMStatus: {
            status: storageResult.localLLMInitializing ? 'initializing' : 
                   storageResult.localLLMInitialized ? 'initialized' : 'not_initialized',
            model: storageResult.localLLMModel
          }
        };
      }
      
    } catch (error) {
      console.error('OCRステータス取得エラー:', error);
      return {
        localLLMAvailable: false,
        geminiAPIAvailable: true,
        currentPriority: 'Gemini API のみ',
        localLLMStatus: {
          status: 'failed',
          error: error.message
        }
      };
    }
  },

  async getUsageStats(request, sender) {
    try {
      const tabs = await chrome.tabs.query({active: true, currentWindow: true});
      if (tabs.length === 0) {
        return { success: false, error: 'アクティブなタブが見つかりません' };
      }
      
      // アクティブなタブから統計を取得
 const result = await new Promise((resolve) => {
  chrome.tabs.sendMessage(tabs[0].id, {
    action: 'getLocalLLMUsageStats'
  }, (response) => {
    if (chrome.runtime.lastError) {
      resolve(null); // エラー時は null を返す
    } else {
      resolve(response);
    }
  });
  
  // 2秒でタイムアウト
  setTimeout(() => resolve(null), 2000);
});
      
      if (result && result.success) {
        return { success: true, stats: result.stats };
      } else {
        // フォールバック: セッションストレージから取得
        return new Promise((resolve) => {
          chrome.storage.session.get(['ocrUsageStats'], (sessionResult) => {
            const stats = sessionResult.ocrUsageStats || [];
            resolve({
              success: true,
              stats: {
                total: stats.length,
                byMethod: {},
                averageTime: {},
                last24Hours: stats.length
              }
            });
          });
        });
      }
      
    } catch (error) {
      console.error('使用統計取得エラー:', error);
      return { success: false, error: error.message };
    }
  },

  async testApiKey(request, sender) {
  if (!request.apiKey) {
    throw new Error("APIキーが指定されていません");
  }
  
  // === 修正: 画像なしのシンプルなテスト ===
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${request.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: "こんにちは" } // 画像なしのシンプルなテスト
          ]
        }],
        generation_config: {
          temperature: 0.1,
          max_output_tokens: 10
        }
      })
    });
    
    if (!response.ok) {
      const err = await response.json();
      const errorMessage = err.error?.message || 'APIエラーが発生しました';
      
      // APIキー関連のエラーかチェック
      if (errorMessage.includes('API key') || errorMessage.includes('invalid') || response.status === 401 || response.status === 403) {
        throw new Error(`無効なAPIキー: ${errorMessage}`);
      } else {
        throw new Error(`API エラー: ${errorMessage}`);
      }
    }
    
    const data = await response.json();
    if (data.candidates && data.candidates.length > 0) {
      return {success: true, message: "APIキーは正常に動作しています"};
    } else {
      return {success: true, message: "APIキーは有効です（レスポンス形式が異なりますが正常）"};
    }
    
  } catch (fetchError) {
    // ネットワークエラーなどの場合
    if (fetchError.message.includes('fetch')) {
      throw new Error('ネットワークエラー: インターネット接続を確認してください');
    }
    throw fetchError;
  }
},

  getVersionInfo(request, sender) {
    const manifest = chrome.runtime.getManifest();
    return {
      version: manifest.version,
      name: manifest.name,
      success: true
    };
  },

  async getDebugInfo(request, sender) {
    const settings = await chrome.storage.local.get(null);
    
    if (settings.geminiApiKey) {
      settings.geminiApiKey = settings.geminiApiKey.substring(0, 5) + "..." + 
                             settings.geminiApiKey.substring(settings.geminiApiKey.length - 4);
    }
    
    return {
      success: true,
      debugInfo: {
        settings: settings,
        browserInfo: {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          language: navigator.language
        },
        extensionInfo: {
          version: chrome.runtime.getManifest().version,
          id: chrome.runtime.id
        },
        cacheInfo: {
          size: imageCache ? imageCache.size : 0
        }
      }
    };
  },

  clearCache(request, sender) {
    if (imageCache) {
      imageCache.clear();
      console.log("画像処理キャッシュをクリアしました");
    }
    return {success: true, message: "キャッシュをクリアしました"};
  },

  async executeFullOcrFromPopup(request, sender) {
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    if (tabs.length === 0) {
      throw new Error("アクティブなタブが見つかりません");
    }
    
    await ensureContentScriptLoaded(tabs[0].id);
    chrome.tabs.sendMessage(tabs[0].id, {action: "processFullImage"});
    return {success: true};
  },

  async executeAreaOcrFromPopup(request, sender) {
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    if (tabs.length === 0) {
      throw new Error("アクティブなタブが見つかりません");
    }
    
    await ensureContentScriptLoaded(tabs[0].id);
    chrome.tabs.sendMessage(tabs[0].id, {action: "startSelection"});
    return {success: true};
  },

    async checkApiKey(request, sender) {
    const hasKey = await secureKeyManager.keyExists();
    const isValid = hasKey ? await secureKeyManager.validateKey() : false;
    return {
      hasKey: hasKey,
      isValid: isValid
    };
  },
  
  async getDebugInfo(request, sender) {
    const settings = await chrome.storage.local.get(null);
    
    // ===== 修正: APIキーを完全に除外 =====
    if (settings.geminiApiKey) {
      settings.geminiApiKey = "[設定済み - セキュリティのため非表示]";
    }
    // =====================================
    
    return {
      success: true,
      debugInfo: {
        settings: settings,
        browserInfo: {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          language: navigator.language
        },
        extensionInfo: {
          version: chrome.runtime.getManifest().version,
          id: chrome.runtime.id
        },
        cacheInfo: {
          size: imageCache ? imageCache.size : 0
        }
      }
    };
  }
};
class EnhancedHybridOCRManager extends HybridOCRManager {
  constructor() {
    super();
    this.localLLMAvailable = false;
  }

  async extractText(imageData, options = {}) {
    console.log('Enhanced Hybrid OCR処理開始');
    
    // まずローカルLLMを試行
    if (this.localLLMAvailable) {
      try {
        const tabs = await chrome.tabs.query({active: true, currentWindow: true});
        if (tabs.length > 0) {
          const result = await chrome.tabs.sendMessage(tabs[0].id, {
            action: 'extractTextWithLocalLLM',
            imageData: imageData,
            options: options
          });
          
          if (result && result.success) {
            console.log('ローカルLLMで処理成功');
            return {
              text: result.text,
              confidence: result.confidence || 0.85,
              source: 'local-llm'
            };
          }
        }
      } catch (error) {
        console.warn('ローカルLLM処理失敗、Geminiにフォールバック:', error);
      }
    }
    
    // フォールバック: 既存のGemini API処理
    console.log('Gemini APIで処理中');
    return await super.extractText(imageData, options);
  }

  getStatus() {
    return {
      ...super.getStatus(),
      localLLMAvailable: this.localLLMAvailable
    };
  }
}
// メッセージリスナーの改善版
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Service Worker生存確認をログ出力
  console.log(`Message received: ${request.action} from tab:${sender.tab?.id || 'popup'}`);
  
  (async () => {
    try {
      // pingリクエストは最優先で処理
      if (request.action === 'ping') {
        sendResponse({
          success: true,
          timestamp: Date.now(),
          serviceWorker: 'active'
        });
        return;
      }
      
      const handler = messageHandlers[request.action];
      if (!handler) {
        console.warn(`Unknown action: ${request.action}`);
        sendResponse({
          success: false, 
          error: `不明なアクション: ${request.action}`
        });
        return;
      }
      
      const result = await handler(request, sender);
      console.log(`Action ${request.action} completed successfully`);
      sendResponse(result);
      
    } catch (error) {
      console.error(`Action ${request.action} failed:`, error);
      sendResponse({
        success: false, 
        error: getReadableErrorMessage ? getReadableErrorMessage(error) : error.message
      });
    }
  })();
  
  return true; // 非同期処理を示す
});

/**
 * タブ接続管理の改善
 */
const connectedTabs = new Set();

chrome.tabs.onActivated.addListener((activeInfo) => {
  connectedTabs.add(activeInfo.tabId);
  console.log(`Tab ${activeInfo.tabId} activated`);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  connectedTabs.delete(tabId);
  console.log(`Tab ${tabId} removed`);
  
  // 処理中のタブがあれば状態をクリア
  if (isTabProcessing(tabId)) {
    setTabProcessing(tabId, false);
    console.log(`Cleared processing state for removed tab ${tabId}`);
  }
});

/**
 * アラーム機能を使ったService Worker維持（代替手段）
 */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    console.log('Alarm-based keep-alive triggered');
    // 軽量な処理でService Workerを維持
    chrome.storage.local.get(['lastKeepAlive'], (result) => {
      chrome.storage.local.set({ 
        lastKeepAlive: Date.now() 
      });
    });
  }
});

// アラームの設定
chrome.alarms.create('keepAlive', {
  delayInMinutes: 1,
  periodInMinutes: 1
});

/**
 * ローカルLLM初期化ハンドラーの改善版
 */
messageHandlers.initializeLocalLLM = async function(request, sender) {
  console.log('=== ローカルLLM初期化リクエスト受信 ===');
  console.log('Request details:', {
    model: request.model,
    senderId: sender.tab?.id || 'popup',
    timestamp: new Date().toISOString()
  });
  
  try {
    const modelKey = request.model || 'phi3-mini';
    const modelConfig = LOCAL_LLM_MODELS[modelKey];
    
    if (!modelConfig) {
      throw new Error(`未対応のモデル: ${modelKey}`);
    }
    
    console.log(`ローカルLLM初期化開始: ${modelConfig.displayName}`);
    
    // アクティブなタブを取得（改善版）
    const tabs = await new Promise((resolve, reject) => {
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (chrome.runtime.lastError) {
          reject(new Error(`タブ取得エラー: ${chrome.runtime.lastError.message}`));
        } else if (!tabs || tabs.length === 0) {
          reject(new Error('アクティブなタブが見つかりません。ブラウザでWebページを開いてから再試行してください。'));
        } else {
          resolve(tabs);
        }
      });
    });
    
    const tabId = tabs[0].id;
    console.log(`Target tab: ${tabId} (${tabs[0].url})`);
    
    // Content scriptの存在確認
    let contentScriptReady = false;
    try {
      const pingResult = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Content script ping timeout'));
        }, 3000);
        
        chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error(`Content script not responding: ${chrome.runtime.lastError.message}`));
          } else {
            resolve(response);
          }
        });
      });
      
      contentScriptReady = !!(pingResult && pingResult.status === 'ok');
      console.log('Content script ping result:', pingResult);
      
    } catch (pingError) {
      console.log('Content script ping failed:', pingError.message);
      
      // Content scriptを注入
      try {
        console.log('Injecting content script...');
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['content.js']
        });
        
        // 注入後に再度確認
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const retryPingResult = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Content script ping timeout after injection'));
          }, 5000);
          
          chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
              reject(new Error(`Content script still not responding: ${chrome.runtime.lastError.message}`));
            } else {
              resolve(response);
            }
          });
        });
        
        contentScriptReady = !!(retryPingResult && retryPingResult.status === 'ok');
        console.log('Content script injection result:', retryPingResult);
        
      } catch (injectionError) {
        console.error('Content script injection failed:', injectionError);
        throw new Error(`Content scriptの注入に失敗しました: ${injectionError.message}`);
      }
    }
    
    if (!contentScriptReady) {
      throw new Error('Content scriptの準備ができていません。ページを再読み込みして再試行してください。');
    }
    
    // ローカルLLM初期化をContent scriptに依頼
    console.log('Sending initialization request to content script...');
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('ローカルLLM初期化がタイムアウトしました（5分）'));
      }, 5 * 60 * 1000); // 5分タイムアウト
      
      chrome.tabs.sendMessage(tabId, {
        action: 'initializeLocalLLMModel',
        model: modelConfig.webllmName
      }, (response) => {
        clearTimeout(timeout);
        
        if (chrome.runtime.lastError) {
          reject(new Error(`Content script通信エラー: ${chrome.runtime.lastError.message}`));
        } else if (!response) {
          reject(new Error('Content scriptから応答がありません'));
        } else {
          resolve(response);
        }
      });
    });
    
    console.log('Content script response:', result);
    
    if (result && result.success) {
      // 成功時の設定保存
      await chrome.storage.local.set({
        'localLLMInitialized': true,
        'localLLMModel': modelConfig.webllmName,
        'preferredLocalModel': modelKey,
        'localLLMLastInitialized': Date.now()
      });
      
      console.log('=== ローカルLLM初期化成功 ===');
      return { 
        success: true, 
        model: modelConfig.displayName,
        timestamp: Date.now()
      };
    } else {
      const errorMsg = result?.error || 'Content scriptから不明なエラーが返されました';
      console.error('Content script initialization failed:', errorMsg);
      throw new Error(errorMsg);
    }
    
  } catch (error) {
    console.error('=== ローカルLLM初期化エラー ===');
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    
    // エラー状態を保存
    await chrome.storage.local.set({
      'localLLMInitialized': false,
      'localLLMInitializationError': error.message,
      'localLLMLastError': Date.now()
    });
    
    return { 
      success: false, 
      error: error.message,
      timestamp: Date.now()
    };
  }
};

/**
 * デバッグ情報取得の改善版
 */
messageHandlers.getDebugInfo = async function(request, sender) {
  const settings = await chrome.storage.local.get(null);
  
  // APIキーを安全にマスク
  if (settings.geminiApiKey) {
    settings.geminiApiKey = "[設定済み - セキュリティのため非表示]";
  }
  
      return {
    success: true,
    debugInfo: {
      serviceWorker: {
        active: true,
        keepAliveRunning: !!keepAliveInterval,
        connectedTabs: Array.from(connectedTabs),
        timestamp: Date.now()
      },
      settings: settings,
      browserInfo: {
        userAgent: navigator?.userAgent || 'unknown',
        platform: navigator?.platform || 'unknown', 
        language: navigator?.language || 'unknown'
      },
      extensionInfo: {
        version: chrome.runtime.getManifest().version,
        id: chrome.runtime.id
      },
      cacheInfo: {
        size: imageCache ? imageCache.size : 0
      },
      processingStatus: {
        activeProcessing: Array.from(activeProcessing),
        currentProcessingTabId: currentProcessingTabId
      }
    }
  };
};
/**
 * STREAMED Dock サイト専用のOCR処理ハンドラ
 * @param {Object} request - リクエスト情報
 * @param {Object} sender - 送信者情報
 * @param {Function} sendResponse - レスポンス送信関数
 * @returns {boolean} - 非同期処理を示すブール値
 */
function streamedDockOcrHandler(request, sender, sendResponse) {
  console.log('STREAMED Dock 専用 OCR リクエスト:', request.field || '不明なフィールド');
  
  const tabId = sender.tab?.id;
  if (!tabId) {
    console.error('有効なタブIDが取得できません');
    sendResponse({success: false, error: "タブが無効です"});
    return true;
  }

if (isTabProcessing(tabId)) {
  console.log('タブ', tabId, 'は既に処理中です - 強制解除して続行');
  setTabProcessing(tabId, false); // 強制的にリセット
  }

  // 処理開始をマーク
  setTabProcessing(tabId, true);
  // ===============================
  currentProcessingTabId = tabId;
  
  // 既存のエラー通知をクリア（安全な送信）
  safeTabMessage(tabId, {action: "clearErrorNotifications"});

  // 画像データのバリデーション
  if (!request.imageData || typeof request.imageData !== 'string' || !request.imageData.startsWith('data:image/')) {
    console.error("無効な画像データです");
    safeTabMessage(tabId, {
      action: "showError",
      error: "無効な画像データです。再度お試しください。"
    });
    
   setTabProcessing(tabId, false);

    sendResponse({success: false, error: "無効な画像データです"});
    return true;
  }
  

  // 処理全体を Promise でラップして制御
  const processingPromise = new Promise((resolve, reject) => {
    chrome.storage.local.get(['ocrLanguage', 'ocrMode', 'geminiApiKey', 'geminiModel'], function(result) {
      const language = result.ocrLanguage || 'ja';
      const mode = result.ocrMode || 'accurate';
      const model = result.geminiModel || 'gemini-2.0-flash';
      
      if (!result.geminiApiKey) {
        const error = new Error("APIキーが設定されていません");
        reject(error);
        return;
      }
        // 待機メッセージを送信（安全な送信）
  safeTabMessage(tabId, {
    action: "showProcessing",
    message: "Gemini APIでテキスト認識中..."
  });
  
      processImageForOCR(request.imageData, {
        language: language,
        mode: mode,
        fieldType: request.field,
        model: model,
        region: request.region,
        rotation: request.rotation,
        isQuarterRotated: request.isQuarterRotated
      })
      .then(result => {
        // 処理中通知を非表示（安全な送信）
        return safeTabMessage(tabId, { action: "hideProcessing" })
          .then(() => result);
      })
      .then(result => {
        // OCR結果の処理分岐
        if (request.field === 'payee-name') {
          const multiFieldResult = parseMultiFieldResult(result.text);
          console.log('複数フィールド解析結果:', multiFieldResult);
          
          return safeTabMessage(tabId, {
            action: "checkFieldValues",
            fields: ['payee-name', 'phone-number']
          }).then(fieldValues => {
            return {
              result: { 
                'payee-name': multiFieldResult['payee-name'],
                'phone-number': multiFieldResult['phone-number']
              },
              fieldValues: fieldValues || {},
              mode: 'multi-field'
            };
          });
        } else {
          const processedText = postProcessOcrResult(result.text, request.field);
          
          return safeTabMessage(tabId, {
            action: "checkFieldValues",
            fields: [request.field]
          }).then(fieldValues => {
            return {
              result: { [request.field]: processedText },
              fieldValues: fieldValues || {},
              mode: 'single-field'
            };
          });
        }
      })
      .then(data => {
        // フィールド入力処理
        const actions = [];
        let successMessage = "";
        
        // 電話番号の処理関数（安全な送信版）
        const processPhoneNumber = (phoneText, currentValue) => {
          if (!phoneText) return { actions: [], message: "" };
          
          console.log('電話番号処理:', phoneText);
          
          let phoneNumbers = [];
          const hasMultipleCandidates = phoneText.includes(',') || phoneText.includes('、') || phoneText.includes(';');
          
          if (hasMultipleCandidates) {
            phoneNumbers = phoneText.split(/[,、;]/)
              .map(num => num.trim())
              .filter(num => num && /\d/.test(num));
            console.log('複数の電話番号候補を検出:', phoneNumbers);
          } else {
            phoneNumbers = [phoneText];
            console.log('単一の電話番号:', phoneNumbers);
          }
          
          const result = {
            actions: [],
            message: ""
          };
          
          if (phoneNumbers.length > 0) {
            result.actions.push(safeTabMessage(tabId, {
              action: "streamedDockPhoneDropdown",
              phoneNumbers: phoneNumbers,
              originalText: phoneText
            }));
            
            const phonesText = phoneNumbers.length > 1 ? 
              `複数の電話番号（${phoneNumbers.length}件）` : 
              `電話番号「${phoneNumbers[0]}」`;
            
            result.message = `${phonesText}を認識しました。ドロップダウンから選択してください`;
          }
          
          return result;
        };

        // 支払先名の処理関数（安全な送信版）
        const processPayeeName = (payeeNameText) => {
          if (!payeeNameText) return { actions: [], message: "" };
          
          console.log('支払先名処理:', payeeNameText);
          
          const hasMultipleCandidates = payeeNameText.includes(',') || payeeNameText.includes('、');
          
          if (hasMultipleCandidates) {
            const payeeNames = payeeNameText.split(/[,、]/)
              .map(name => name.trim())
              .filter(name => name.length > 0);
            
            console.log('複数の支払先名候補を検出:', payeeNames);
            
            const uniquePayeeNames = [...new Set(payeeNames)];
            
            if (uniquePayeeNames.length > 1) {
              return {
                actions: [safeTabMessage(tabId, {
                  action: "showPayeeNameDropdown",
                  payeeNames: uniquePayeeNames
                })],
                message: `複数の支払先名候補（${uniquePayeeNames.length}件）を認識しました。選択してください`
              };
            } else if (uniquePayeeNames.length === 1) {
              return {
                actions: [safeTabMessage(tabId, {
                  action: "fillTextField",
                  text: uniquePayeeNames[0],
                  field: 'payee-name'
                })],
                message: `「${uniquePayeeNames[0]}」を認識しました`
              };
            }
          } else {
            return {
              actions: [safeTabMessage(tabId, {
                action: "fillTextField",
                text: payeeNameText,
                field: 'payee-name'
              })],
              message: `「${payeeNameText}」を認識しました`
            };
          }
          
          return { actions: [], message: "" };
        };

        // モード別の処理
        if (data.mode === 'single-field') {
          const field = Object.keys(data.result)[0];
          const text = data.result[field];
          
          if (!text || text.trim() === '') {
            let noResultMessage = "";
            if (field === 'phone-number') {
              noResultMessage = "電話番号が認識できませんでした。別の領域を選択するか、画質を確認してください。";
            } else if (field === 'payee-name') {
              noResultMessage = "支払先名が認識できませんでした。別の領域を選択するか、画質を確認してください。";
            } else if (field === 'phonetic') {
              noResultMessage = "ふりがなが認識できませんでした。別の領域を選択するか、画質を確認してください。";
            } else {
              noResultMessage = "テキストが認識できませんでした。別の領域を選択するか、画質を確認してください。";
            }
            
            actions.push(safeTabMessage(tabId, {
              action: "showError",
              error: noResultMessage
            }));

            actions.push(safeTabMessage(tabId, {
              action: "updatePreviewStatus",
              status: "認識結果なし",
              type: "error"
            }));

            successMessage = "";
          } else {
            if (field === 'phone-number') {
              const currentValue = data.fieldValues[field] || '';
              const phoneResult = processPhoneNumber(text, currentValue);
              
              actions.push(...phoneResult.actions);
              successMessage = phoneResult.message || "電話番号を認識できませんでした";
            } else if (field === 'payee-name') {
              const payeeResult = processPayeeName(text);
              
              actions.push(...payeeResult.actions);
              successMessage = payeeResult.message || "支払先名を認識できませんでした";
            } else {
              actions.push(safeTabMessage(tabId, {
                action: "fillTextField",
                text: text,
                field: field
              }));
              successMessage = `「${text}」を認識しました`;
            }
          }
        } else {
          // 複数フィールド処理の場合
          const originalField = 'payee-name';
          
          if ((!data.result['payee-name'] || data.result['payee-name'].trim() === '') && 
              (!data.result['phone-number'] || data.result['phone-number'].trim() === '')) {
              
            const noResultMessage = "支払先名も電話番号も認識できませんでした。別の領域を選択するか、画質を確認してください。";
            
            actions.push(safeTabMessage(tabId, {
              action: "showError", 
              error: noResultMessage
            }));
            
            actions.push(safeTabMessage(tabId, {
              action: "updatePreviewStatus",
              status: "認識結果なし",
              type: "error"
            }));
            
            successMessage = "";
          } else {
            if (data.result['payee-name']) {
                const payeeResult = processPayeeName(data.result['payee-name']);
                actions.push(...payeeResult.actions);
                successMessage = payeeResult.message;
            }
            
            if (data.result['phone-number']) {
              const currentValue = data.fieldValues['phone-number'] || '';
              const phoneResult = processPhoneNumber(data.result['phone-number'], currentValue);
              
              actions.push(...phoneResult.actions);
              
              if (phoneResult.message) {
                successMessage += successMessage ? 
                  `、${phoneResult.message}` : 
                  phoneResult.message;
              }
            }

            actions.push(safeTabMessage(tabId, {
              action: "restoreFocus",
              field: originalField
            }));
          }
        }
        
        // すべてのアクションが完了したら通知を表示
        return Promise.all(actions).then(() => {
          if (successMessage) {
            return safeTabMessage(tabId, {
              action: "showNotification",
              message: successMessage,
              type: "success"
            }).then(() => {
              return safeTabMessage(tabId, {
                action: "updatePreviewStatus",
                status: successMessage,
                type: "success"
              });
            });
          }
          return Promise.resolve();
        });
      })
      .then(() => {
        resolve({ success: true });
      })
      .catch(error => {
        console.error("処理エラー:", error);
        
        // エラー処理（安全な送信）
        safeTabMessage(tabId, { action: "hideProcessing" })
          .then(() => {
            return safeTabMessage(tabId, {
              action: "showError",
              error: getReadableErrorMessage(error)
            });
          })
          .finally(() => {
            reject(error);
          });
      });
    });
  });
  
  // 処理完了時に sendResponse を呼び出す
  processingPromise
    .then(result => {
      sendResponse(result);
    })
    .catch(error => {
      sendResponse({
        success: false, 
        error: getReadableErrorMessage(error)
      });
    })
      .finally(() => {
      // ===== 処理完了を必ずマーク =====
      setTabProcessing(tabId, false);
      console.log('タブ', tabId, 'の処理が完了しました');
      // ==============================
    });
  return true;
}





// ===== MLC-AI WebLLMモデルの正式設定 =====
const LOCAL_LLM_MODELS = {
  'phi3-mini': {
    huggingFaceRepo: 'mlc-ai/Phi-3-mini-4k-instruct-q4f16_1-MLC',
    webllmName: 'Phi-3-mini-4k-instruct-q4f16_1-MLC',
    displayName: 'Phi-3 Mini 4K',
    size: '2.4GB',
    description: '高速で軽量、OCRに適している',
    recommended: true,
    modelFiles: [
      {
        filename: 'mlc-chat-config.json',
        url: 'https://huggingface.co/mlc-ai/Phi-3-mini-4k-instruct-q4f16_1-MLC/resolve/main/mlc-chat-config.json'
      },
      {
        filename: 'tokenizer.json',
        url: 'https://huggingface.co/mlc-ai/Phi-3-mini-4k-instruct-q4f16_1-MLC/resolve/main/tokenizer.json'
      },
      {
        filename: 'tokenizer_config.json',
        url: 'https://huggingface.co/mlc-ai/Phi-3-mini-4k-instruct-q4f16_1-MLC/resolve/main/tokenizer_config.json'
      },
      {
        filename: 'params_shard_0.bin',
        url: 'https://huggingface.co/mlc-ai/Phi-3-mini-4k-instruct-q4f16_1-MLC/resolve/main/params_shard_0.bin',
        size: '2.4GB'
      }
    ]
  },
  
  'llama32-3b': {
    huggingFaceRepo: 'mlc-ai/Llama-3.2-3B-Instruct-q4f16_1-MLC',
    webllmName: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    displayName: 'Llama 3.2 3B',
    size: '2.0GB',
    description: '高精度、テキスト理解に優れている',
    recommended: true,
    modelFiles: [
      {
        filename: 'mlc-chat-config.json',
        url: 'https://huggingface.co/mlc-ai/Llama-3.2-3B-Instruct-q4f16_1-MLC/resolve/main/mlc-chat-config.json'
      },
      {
        filename: 'tokenizer.json',
        url: 'https://huggingface.co/mlc-ai/Llama-3.2-3B-Instruct-q4f16_1-MLC/resolve/main/tokenizer.json'
      },
      {
        filename: 'params_shard_0.bin',
        url: 'https://huggingface.co/mlc-ai/Llama-3.2-3B-Instruct-q4f16_1-MLC/resolve/main/params_shard_0.bin',
        size: '2.0GB'
      }
    ]
  },
  
  'llama32-1b': {
    huggingFaceRepo: 'mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC',
    webllmName: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    displayName: 'Llama 3.2 1B',
    size: '800MB',
    description: '最軽量、低性能デバイス向け',
    recommended: false,
    modelFiles: [
      {
        filename: 'mlc-chat-config.json',
        url: 'https://huggingface.co/mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC/resolve/main/mlc-chat-config.json'
      },
      {
        filename: 'tokenizer.json',
        url: 'https://huggingface.co/mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC/resolve/main/tokenizer.json'
      },
      {
        filename: 'params_shard_0.bin',
        url: 'https://huggingface.co/mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC/resolve/main/params_shard_0.bin',
        size: '800MB'
      }
    ]
  },
  
  'gemma2-2b': {
    huggingFaceRepo: 'mlc-ai/gemma-2-2b-it-q4f16_1-MLC',
    webllmName: 'gemma-2-2b-it-q4f16_1-MLC',
    displayName: 'Gemma 2 2B',
    size: '1.6GB',
    description: 'Google製、バランス型',
    recommended: false,
    modelFiles: [
      {
        filename: 'mlc-chat-config.json',
        url: 'https://huggingface.co/mlc-ai/gemma-2-2b-it-q4f16_1-MLC/resolve/main/mlc-chat-config.json'
      },
      {
        filename: 'tokenizer.json',
        url: 'https://huggingface.co/mlc-ai/gemma-2-2b-it-q4f16_1-MLC/resolve/main/tokenizer.json'
      },
      {
        filename: 'params_shard_0.bin',
        url: 'https://huggingface.co/mlc-ai/gemma-2-2b-it-q4f16_1-MLC/resolve/main/params_shard_0.bin',
        size: '1.6GB'
      }
    ]
  }
};

// ===== ダウンロード管理クラス =====
class LocalModelDownloader {
  constructor() {
    this.downloadQueue = new Map();
    this.downloadProgress = new Map();
  }
  
  async downloadModel(modelKey, progressCallback = null) {
    const modelConfig = LOCAL_LLM_MODELS[modelKey];
    if (!modelConfig) {
      throw new Error(`未対応のモデル: ${modelKey}`);
    }
    
    console.log(`モデルダウンロード開始: ${modelConfig.displayName}`);
    
    try {
      const modelDir = `models/${modelKey}/`;
      
      const downloadPromises = modelConfig.modelFiles.map((file, index) => {
        return this.downloadFile(
          file.url, 
          `${modelDir}${file.filename}`,
          (progress) => {
            const totalFiles = modelConfig.modelFiles.length;
            const fileProgress = (index + progress) / totalFiles * 100;
            
            if (progressCallback) {
              progressCallback({
                progress: fileProgress / 100,
                text: `${file.filename} をダウンロード中... (${Math.round(progress * 100)}%)`
              });
            }
          }
        );
      });
      
      await Promise.all(downloadPromises);
      
      await chrome.storage.local.set({
        [`model_${modelKey}_downloaded`]: true,
        [`model_${modelKey}_path`]: modelDir,
        [`model_${modelKey}_timestamp`]: Date.now()
      });
      
      console.log(`モデルダウンロード完了: ${modelConfig.displayName}`);
      
      if (progressCallback) {
        progressCallback({
          progress: 1.0,
          text: 'ダウンロード完了'
        });
      }
      
      return true;
      
    } catch (error) {
      console.error(`モデルダウンロードエラー (${modelKey}):`, error);
      
      await chrome.storage.local.set({
        [`model_${modelKey}_error`]: error.message,
        [`model_${modelKey}_error_timestamp`]: Date.now()
      });
      
      throw error;
    }
  }
  
  async downloadFile(url, filename, progressCallback = null) {
    return new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(`ダウンロード開始エラー: ${chrome.runtime.lastError.message}`));
          return;
        }
        
        console.log(`ダウンロード開始: ${filename} (ID: ${downloadId})`);
        
        this.downloadQueue.set(downloadId, {
          url: url,
          filename: filename,
          progressCallback: progressCallback,
          resolve: resolve,
          reject: reject
        });
      });
    });
  }
  
  setupDownloadListener() {
    chrome.downloads.onChanged.addListener((delta) => {
      const downloadInfo = this.downloadQueue.get(delta.id);
      if (!downloadInfo) return;
      
      if (delta.bytesReceived && delta.totalBytes) {
        const progress = delta.bytesReceived.current / delta.totalBytes.current;
        if (downloadInfo.progressCallback) {
          downloadInfo.progressCallback(progress);
        }
      }
      
      if (delta.state && delta.state.current === 'complete') {
        console.log(`ダウンロード完了: ${downloadInfo.filename}`);
        downloadInfo.resolve(delta.id);
        this.downloadQueue.delete(delta.id);
      }
      
      if (delta.state && delta.state.current === 'interrupted') {
        console.error(`ダウンロード失敗: ${downloadInfo.filename}`);
        downloadInfo.reject(new Error('ダウンロードが中断されました'));
        this.downloadQueue.delete(delta.id);
      }
    });
  }
  
  async isModelDownloaded(modelKey) {
    const result = await chrome.storage.local.get([`model_${modelKey}_downloaded`]);
    return result[`model_${modelKey}_downloaded`] === true;
  }
  
  async getModelPath(modelKey) {
    const result = await chrome.storage.local.get([`model_${modelKey}_path`]);
    return result[`model_${modelKey}_path`] || null;
  }
}

// ===== グローバルインスタンス =====
const modelDownloader = new LocalModelDownloader();
modelDownloader.setupDownloadListener();

// ===== WebLLM名からモデルキーへの変換マップ =====
const WEBLLM_TO_KEY_MAP = {
  'Phi-3-mini-4k-instruct-q4f16_1-MLC': 'phi3-mini',
  'Llama-3.2-3B-Instruct-q4f16_1-MLC': 'llama32-3b',
  'Llama-3.2-1B-Instruct-q4f16_1-MLC': 'llama32-1b',
  'gemma-2-2b-it-q4f16_1-MLC': 'gemma2-2b'
};

// ===== モデル名正規化関数 =====
function normalizeModelName(modelName) {
  // WebLLM形式の名前をキーに変換
  if (WEBLLM_TO_KEY_MAP[modelName]) {
    return WEBLLM_TO_KEY_MAP[modelName];
  }
  
  // 既にキー形式の場合はそのまま
  if (LOCAL_LLM_MODELS[modelName]) {
    return modelName;
  }
  
  // どちらでもない場合はデフォルト
  console.warn(`未知のモデル名: ${modelName}, デフォルトを使用`);
  return 'phi3-mini';
}

// ===== 既存のmessageHandlersに新しいハンドラーを追加 =====
// initializeLocalLLMハンドラーを拡張
const originalInitializeLocalLLM = messageHandlers.initializeLocalLLM;
messageHandlers.initializeLocalLLM = async function(request, sender) {
  try {
    // モデル名を正規化
    const inputModel = request.model || 'phi3-mini';
    const modelKey = normalizeModelName(inputModel);
    const modelConfig = LOCAL_LLM_MODELS[modelKey];
    
    console.log(`モデル名変換: ${inputModel} → ${modelKey}`);
    
    if (!modelConfig) {
      throw new Error(`未対応のモデル: ${modelKey}`);
    }
    
    console.log(`ローカルLLM初期化開始: ${modelConfig.displayName}`);
    
    // ダウンロード状態をチェック
    const isDownloaded = await modelDownloader.isModelDownloaded(modelKey);
    
    if (!isDownloaded) {
      console.log('モデルがダウンロードされていません。ダウンロードを開始します...');
      
      const progressCallback = (progress) => {
        try {
          chrome.runtime.sendMessage({
            action: "updateModelProgress",
            progress: progress.progress * 100,
            text: progress.text
          }).catch(() => {});
        } catch (e) {}
      };
      
      await modelDownloader.downloadModel(modelKey, progressCallback);
    }
    
    // ダウンロード済みモデルでWebLLMを初期化
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    if (tabs.length === 0) {
      throw new Error('アクティブなタブが見つかりません');
    }
    
    const tabId = tabs[0].id;
    const modelPath = await modelDownloader.getModelPath(modelKey);
    
    const result = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, {
        action: 'initializeLocalLLMModel',
        model: modelConfig.webllmName,
        modelPath: modelPath,
        useLocal: true
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
    
    if (result && result.success) {
      await chrome.storage.local.set({
        'localLLMInitialized': true,
        'localLLMModel': modelConfig.webllmName,
        'preferredLocalModel': modelKey,
        'useLocalFiles': true
      });
      
      return { 
        success: true, 
        model: modelConfig.displayName,
        downloaded: true,
        localPath: modelPath
      };
    } else {
      throw new Error(result?.error || '初期化に失敗しました');
    }
    
  } catch (error) {
    console.error('ローカルLLM初期化エラー:', error);
    return { success: false, error: error.message };
  }
};

// 新しいハンドラーを追加
messageHandlers.getModelDownloadStatus = async function(request, sender) {
  const modelKey = request.model || 'phi3-mini';
  const isDownloaded = await modelDownloader.isModelDownloaded(modelKey);
  const modelPath = await modelDownloader.getModelPath(modelKey);
  
  return {
    success: true,
    downloaded: isDownloaded,
    modelPath: modelPath,
    modelInfo: LOCAL_LLM_MODELS[modelKey] || null
  };
};

messageHandlers.getAvailableModels = async function(request, sender) {
  return {
    success: true,
    models: LOCAL_LLM_MODELS
  };
};

// ===== ページ起動時の初期化 =====
chrome.runtime.onStartup.addListener(async () => {
  console.log('拡張機能起動 - モデルダウンロード状態を確認中...');
  
  for (const [modelKey, config] of Object.entries(LOCAL_LLM_MODELS)) {
    const isDownloaded = await modelDownloader.isModelDownloaded(modelKey);
    console.log(`${config.displayName}: ${isDownloaded ? '✓ ダウンロード済み' : '○ 未ダウンロード'}`);
  }
});






// chrome.tabs.onUpdated リスナー

chrome.tabs.onRemoved.addListener(function(tabId, removeInfo) {
  if (isTabProcessing(tabId)) {
    console.log('閉じられたタブ', tabId, 'の処理状態をクリア');
    setTabProcessing(tabId, false);
  }
});

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
  // URLが設定されており、かつロード完了時
  if (changeInfo.status === 'complete' && tab.url) {
    // 特定のURLとの完全一致を確認
    const targetUrl = "https://dock.streamedup.com/receipt2/step/registvendor?step=regist";
    if (tab.url === targetUrl || tab.url.startsWith(targetUrl + "#")) {
      console.log('対象のURLを検出:', tab.url);
      
      // STREAMED Dock 連携スクリプトを注入
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["streamed-dock-integration.js"]
      }).then(() => {
        console.log('STREAMED Dock 連携スクリプトを注入しました');
      }).catch(err => {
        console.error('STREAMED Dock 連携スクリプト注入エラー:', err);
      });
    } else {
      console.log('対象外のURLのため、OCR機能は有効化しません:', tab.url);
    }
  }
});