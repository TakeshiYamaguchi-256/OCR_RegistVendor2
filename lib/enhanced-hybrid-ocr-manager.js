// enhanced-hybrid-ocr-manager.js の修正版

// === 修正: 即座実行関数で囲む ===
(function() {
  'use strict';
  
  // 重複読み込み防止チェック
  if (typeof window.EnhancedHybridOCRManager !== 'undefined') {
    console.log('EnhancedHybridOCRManager は既に読み込まれています');
    return; // 関数内なので正常動作
  }

  /**
   * 簡素化版HybridOCRManager - ローカルLLM + Gemini API
   * PaddleOCRを削除し、2段階処理に簡素化
   */
  class EnhancedHybridOCRManager {
    constructor() {
      this.localLLM = null;
      this.useLocalLLM = true;
      this.localLLMReady = false;
      this.fallbackToGemini = true;
    }

    async initialize() {
      console.log('Enhanced Hybrid OCR Manager 初期化開始（簡素化版）');
      
      // 設定を読み込み
      const settings = await chrome.storage.local.get(['useLocalLLM', 'preferredLocalModel']);
      this.useLocalLLM = settings.useLocalLLM !== false; // デフォルトtrue
      
      // ローカルLLMエンジンをロード
      if (this.useLocalLLM) {
        try {
          await this.loadScript(chrome.runtime.getURL('lib/local-llm-engine.js'));
if (!window.localLLMEngine && window.LocalLLMEngine) {
  window.localLLMEngine = new window.LocalLLMEngine();
}

          this.localLLM = window.localLLMEngine;
          
          const preferredModel = settings.preferredLocalModel || 'moondream2';
          await this.localLLM.initialize(preferredModel);
          this.localLLMReady = true;
          
          console.log('ローカルLLM初期化完了');
        } catch (error) {
          console.warn('ローカルLLM初期化失敗:', error);
          this.useLocalLLM = false;
        }
      }
    }

    async extractText(imageData, options = {}) {
      const startTime = Date.now();
      let finalResult = null;
      let usedMethod = 'unknown';

      console.log('OCR処理開始 - 利用可能な方法:', {
        localLLM: this.localLLMReady,
        gemini: this.fallbackToGemini
      });

      // 優先順位: ローカルLLM → Gemini API（2段階のみ）
      
      // 1. ローカルLLM優先実行
      if (this.useLocalLLM && this.localLLMReady) {
        try {
          console.log('ローカルLLMで処理中...');
          const result = await this.localLLM.extractText(imageData, options);
          
          if (this.isValidResult(result.text, options)) {
            finalResult = result;
            usedMethod = 'local-llm';
            console.log(`ローカルLLM成功 (${Date.now() - startTime}ms):`, result.text.substring(0, 50));
          } else {
            console.log('ローカルLLM結果が無効、Gemini APIにフォールバック');
          }
        } catch (error) {
          console.warn('ローカルLLM処理失敗:', error);
        }
      }

      // 2. Gemini APIフォールバック
      if (!finalResult && this.fallbackToGemini) {
        try {
          console.log('Gemini APIで処理中...');
          const result = await this.extractTextWithGemini(imageData, options);
          finalResult = {
            text: result.text,
            confidence: result.confidence || 0.95,
            source: 'gemini-api'
          };
          usedMethod = 'gemini-api';
          console.log(`Gemini API成功 (${Date.now() - startTime}ms):`, result.text.substring(0, 50));
        } catch (error) {
          console.error('Gemini API処理失敗:', error);
          throw error;
        }
      }

      if (!finalResult) {
        throw new Error('すべてのOCR方法が失敗しました');
      }

      // 結果に使用方法とパフォーマンス情報を追加
      finalResult.usedMethod = usedMethod;
      finalResult.processingTime = Date.now() - startTime;

      // 統計を保存
      this.updateUsageStats(usedMethod, finalResult.processingTime);

      return finalResult;
    }

    // 結果の有効性チェック
    isValidResult(text, options) {
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return false;
      }

      // フィールドタイプ別の検証
      if (options.fieldType === 'phone-number') {
        // 電話番号として有効な文字が含まれているか
        return /[\d\-\+\(\)]/i.test(text);
      } else if (options.fieldType === 'payee-name') {
        // 最低2文字以上で、意味のあるテキストか
        return text.trim().length >= 2 && !/^[0-9\-\+\(\)\s]+$/.test(text);
      }

      // 一般的なテキストの場合
      return text.trim().length >= 1;
    }

    async extractTextWithGemini(imageData, options) {
      // 既存のextractTextWithGemini関数を呼び出し
      if (typeof extractTextWithGemini === 'function') {
        return await extractTextWithGemini(imageData, options);
      } else {
        throw new Error('Gemini API関数が利用できません');
      }
    }

    async loadScript(path) {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = path;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    // 使用統計の更新
    updateUsageStats(method, processingTime) {
      const stats = {
        timestamp: Date.now(),
        method: method,
        processingTime: processingTime
      };

      // セッションストレージに保存（統計用）
      chrome.storage.session.get(['ocrUsageStats'], (result) => {
        const currentStats = result.ocrUsageStats || [];
        currentStats.push(stats);
        
        // 最新100件のみ保持
        if (currentStats.length > 100) {
          currentStats.splice(0, currentStats.length - 100);
        }
        
        chrome.storage.session.set({ 'ocrUsageStats': currentStats });
      });
    }

    // 設定変更時の再初期化
    async updateSettings(newSettings) {
      const { useLocalLLM, preferredLocalModel } = newSettings;
      
      if (useLocalLLM !== this.useLocalLLM) {
        this.useLocalLLM = useLocalLLM;
        if (useLocalLLM && !this.localLLMReady) {
          await this.initialize();
        }
      }

      if (preferredLocalModel && this.localLLM) {
        await this.localLLM.switchModel(preferredLocalModel);
      }
    }

    getStatus() {
      return {
        localLLMAvailable: this.localLLMReady,
        geminiAPIAvailable: this.fallbackToGemini,
        usingLocalLLM: this.useLocalLLM,
        currentPriority: this.getCurrentPriority()
      };
    }

    getCurrentPriority() {
      const methods = [];
      if (this.useLocalLLM && this.localLLMReady) methods.push('ローカルLLM');
      if (this.fallbackToGemini) methods.push('Gemini API');
      return methods.join(' → ');
    }

    // 統計情報取得
    async getUsageStats() {
      return new Promise((resolve) => {
        chrome.storage.session.get(['ocrUsageStats'], (result) => {
          const stats = result.ocrUsageStats || [];
          
          const summary = {
            total: stats.length,
            byMethod: {},
            averageTime: {},
            last24Hours: 0
          };
          
          const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
          
          stats.forEach(stat => {
            summary.byMethod[stat.method] = (summary.byMethod[stat.method] || 0) + 1;
            
            if (!summary.averageTime[stat.method]) {
              summary.averageTime[stat.method] = [];
            }
            summary.averageTime[stat.method].push(stat.processingTime);
            
            if (stat.timestamp > dayAgo) {
              summary.last24Hours++;
            }
          });
          
          // 平均時間を計算
          Object.keys(summary.averageTime).forEach(method => {
            const times = summary.averageTime[method];
            summary.averageTime[method] = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
          });
          
          resolve(summary);
        });
      });
    }
  }

  // グローバルインスタンス（既存のhybridOCRManagerを置き換え）
  window.EnhancedHybridOCRManager = EnhancedHybridOCRManager;

  if (typeof hybridOCRManager !== 'undefined') {
    // 既存のインスタンスがあれば置き換え
    window.hybridOCRManager = new EnhancedHybridOCRManager();
  } else {
    window.hybridOCRManager = new EnhancedHybridOCRManager();
  }

})(); // 即座実行関数の終了