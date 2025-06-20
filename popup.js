// 修復版 popup.js - エラーハンドリングと初期化順序を改善

// グローバル変数の初期化
let selectedModel = 'phi3-mini';
let isInitializing = false;
let initializationAttempts = 0;
const MAX_INIT_ATTEMPTS = 3;

// DOM要素参照の管理
const elements = {};

/**
 * DOM要素を安全に取得し、キャッシュする
 */
function getElement(id) {
  if (!elements[id]) {
    elements[id] = document.getElementById(id);
  }
  return elements[id];
}

/**
 * 改善されたメッセージ送信関数（リトライ機能付き）
 */
async function sendMessageSafely(message, timeoutMs = 10000, retryCount = 3) {
  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      console.log(`メッセージ送信試行 ${attempt}/${retryCount}:`, message.action);
      
      // Chrome runtime の存在確認
      if (!chrome?.runtime?.sendMessage) {
        throw new Error('Chrome拡張APIが利用できません');
      }

      // Background Scriptの生存確認
      try {
        await chrome.runtime.sendMessage({action: "ping"});
      } catch (pingError) {
        console.warn(`試行 ${attempt}: Background Script接続確認失敗`);
        if (attempt < retryCount) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          continue;
        }
        throw new Error('Background Scriptに接続できません。拡張機能を再読み込みしてください。');
      }

      // メイン送信処理
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Background scriptからの応答がタイムアウトしました (${timeoutMs}ms)`));
        }, timeoutMs);

        chrome.runtime.sendMessage(message, (response) => {
          clearTimeout(timeout);
          
          if (chrome.runtime.lastError) {
            const error = chrome.runtime.lastError.message || 'Unknown runtime error';
            console.error(`試行 ${attempt}: Chrome runtime error:`, error);
            reject(new Error(`Runtime error: ${error}`));
            return;
          }
          
          if (response === undefined || response === null) {
            reject(new Error('Background scriptから応答がありません'));
            return;
          }
          
          resolve(response);
        });
      });

      console.log(`試行 ${attempt}: 送信成功`);
      return response;

    } catch (error) {
      console.error(`試行 ${attempt} 失敗:`, error.message);
      
      if (attempt === retryCount) {
        // 最終試行でも失敗した場合、より詳細なエラー情報を提供
        let userFriendlyMessage = error.message;
        
        if (error.message.includes('Could not establish connection')) {
          userFriendlyMessage = 'Background scriptとの接続に失敗しました。拡張機能を再読み込みしてください。';
        } else if (error.message.includes('Receiving end does not exist')) {
          userFriendlyMessage = 'Background scriptが応答しません。拡張機能を再読み込みするか、ブラウザを再起動してください。';
        }
        
        throw new Error(userFriendlyMessage);
      }
      
      // リトライ前の待機時間（指数バックオフ）
      const waitTime = 1000 * Math.pow(2, attempt - 1);
      console.log(`${waitTime}ms後にリトライします...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

/**
 * 通知表示（改善版）
 */
function showNotification(message, type = 'info', duration = 3000) {
  // 既存の通知を削除
  const existingNotifications = document.querySelectorAll('.popup-notification');
  existingNotifications.forEach(notif => notif.remove());
  
  const notification = document.createElement('div');
  notification.className = `popup-notification popup-notification-${type}`;
  notification.textContent = message;
  
  notification.style.cssText = `
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    padding: 8px 16px;
    border-radius: 4px;
    color: white;
    font-size: 12px;
    z-index: 10001;
    pointer-events: none;
    background-color: ${
      type === 'success' ? '#4CAF50' : 
      type === 'error' ? '#f44336' : 
      type === 'warning' ? '#ff9800' : 
      '#2196F3'
    };
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    animation: slideIn 0.3s ease;
  `;
  
  document.body.appendChild(notification);
  
  if (duration > 0) {
    setTimeout(() => {
      if (document.body.contains(notification)) {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
      }
    }, duration);
  }
  
  return notification;
}

/**
 * 設定読み込み（エラーハンドリング強化）
 */
async function loadSettings() {
  console.log('設定読み込み開始');
  
  try {
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('設定読み込みがタイムアウトしました'));
      }, 5000);
      
      chrome.storage.local.get([
        'useLocalLLM', 'fallbackToGemini', 'preferredLocalModel', 
        'ocrLanguage', 'geminiModel', 'ocrMode', 'geminiApiKey',
        'ocrAutoMode', 'localLLMInitialized', 'localLLMModel'
      ], (result) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    });
    
    console.log('設定読み込み完了:', Object.keys(result));
    
    // UI要素の更新
    updateUIFromSettings(result);
    
    return result;
  } catch (error) {
    console.error('設定読み込みエラー:', error);
    showNotification('設定の読み込みに失敗しました', 'error');
    
    // デフォルト設定を返す
    return {
      useLocalLLM: true,
      fallbackToGemini: true,
      preferredLocalModel: 'phi3-mini',
      ocrLanguage: 'ja',
      geminiModel: 'gemini-2.0-flash',
      ocrMode: 'accurate',
      ocrAutoMode: false,
      localLLMInitialized: false
    };
  }
}

/**
 * 設定からUIを更新
 */
function updateUIFromSettings(settings) {
  console.log('UIを設定から更新中...');
  
  try {
    // トグル状態を復元
    const localLlmToggle = getElement('localLlmToggle');
    const geminiToggle = getElement('geminiToggle');
    const autoModeToggle = getElement('autoModeToggle');
    
    if (localLlmToggle) {
      setToggleState(localLlmToggle, settings.useLocalLLM !== false);
    }
    
    if (geminiToggle) {
      setToggleState(geminiToggle, settings.fallbackToGemini !== false);
    }
    
    if (autoModeToggle) {
      const isAutoModeActive = settings.ocrAutoMode === true;
      setToggleState(autoModeToggle, isAutoModeActive);
      updateAutoModeStatus(isAutoModeActive);
    }
    
    // モデル選択を復元
    if (settings.preferredLocalModel) {
      selectedModel = settings.preferredLocalModel;
      updateModelSelection(selectedModel);
    }
    
    // ローカルLLMステータスの復元
    if (settings.localLLMInitialized && settings.localLLMModel) {
      updateLocalLLMStatus(true, 'ローカルLLM利用可能', { 
        status: 'initialized',
        model: settings.localLLMModel 
      });
    } else {
      updateLocalLLMStatus(false, '未初期化');
    }
    
    // 言語設定を復元
    const languageSelect = getElement('language');
    if (languageSelect && settings.ocrLanguage) {
      languageSelect.value = settings.ocrLanguage;
    }
    
    // Geminiモデル設定を復元
    const geminiModelSelect = getElement('geminiModel');
    if (geminiModelSelect && settings.geminiModel) {
      geminiModelSelect.value = settings.geminiModel;
    }
    
    // 処理モード設定を復元
    if (settings.ocrMode) {
      const targetRadio = document.querySelector(`input[name="ocrMode"][value="${settings.ocrMode}"]`);
      if (targetRadio) {
        targetRadio.checked = true;
      }
    }
    
    // APIキー設定状態を確認
    const apiKeyInput = getElement('apiKey');
    if (settings.geminiApiKey && apiKeyInput) {
      apiKeyInput.placeholder = 'APIキーは設定済みです（セキュリティのため非表示）';
      apiKeyInput.style.backgroundColor = '#f0f8ff';
      updateGeminiStatus(true, 'APIキー設定済み');
    } else {
      updateGeminiStatus(false, 'APIキー未設定');
    }
    
    // Gemini設定表示状態
    const geminiSettings = getElement('geminiSettings');
    if (geminiSettings) {
      geminiSettings.style.display = settings.fallbackToGemini !== false ? 'block' : 'none';
    }
    
    console.log('UI更新完了');
  } catch (error) {
    console.error('UI更新エラー:', error);
    showNotification('UIの更新に失敗しました', 'warning');
  }
}

/**
 * モデル選択UIの更新
 */
function updateModelSelection(modelName) {
  try {
    // 全てのモデルカードから選択状態を削除
    const modelCards = document.querySelectorAll('.model-card');
    modelCards.forEach(card => card.classList.remove('selected'));
    
    // 指定されたモデルを選択状態にする
    const targetCard = document.querySelector(`[data-model="${modelName}"]`);
    if (targetCard) {
      targetCard.classList.add('selected');
      console.log('モデル選択を更新:', modelName);
    }
    
    // グローバル変数も更新
    selectedModel = modelName;
  } catch (error) {
    console.error('モデル選択更新エラー:', error);
  }
}

/**
 * トグル状態を設定
 */
function setToggleState(toggle, isActive) {
  if (!toggle) return;
  
  if (isActive) {
    toggle.classList.add('active');
  } else {
    toggle.classList.remove('active');
  }
  
  const indicator = toggle.parentElement?.querySelector('.mode-indicator');
  if (indicator) {
    updateIndicator(indicator, isActive);
  }
}

/**
 * インジケーターの更新
 */
function updateIndicator(indicator, isActive) {
  if (!indicator) return;
  
  if (isActive) {
    if (indicator.id === 'localLlmIndicator') {
      indicator.className = 'mode-indicator mode-local';
      indicator.textContent = 'ローカル';
    } else if (indicator.id === 'geminiIndicator') {
      indicator.className = 'mode-indicator mode-cloud';
      indicator.textContent = 'クラウド';
    } else if (indicator.id === 'autoModeIndicator') {
      indicator.className = 'mode-indicator mode-auto';
      indicator.textContent = 'AUTO';
    }
  } else {
    indicator.className = 'mode-indicator';
    indicator.textContent = 'OFF';
  }
}

/**
 * ローカルLLM状態の更新
 */
function updateLocalLLMStatus(isAvailable, message, statusDetails = {}) {
  const dot = getElement('localLlmStatusDot');
  const text = getElement('localLlmStatusText');
  const button = getElement('initializeLocalLlm');
  
  if (!dot || !text || !button) return;

  // クラスをリセット
  dot.className = 'indicator-dot';
  button.disabled = false;
  button.textContent = 'ローカルLLMを初期化';

  const status = statusDetails.status;
  if (status === 'initialized' || isAvailable) {
    dot.classList.add('indicator-active');
    text.textContent = '利用可能';
    button.disabled = true;
    button.textContent = '初期化済み';
    
    if (statusDetails.model) {
      text.textContent = `利用可能 (${statusDetails.model})`;
    }
  } else if (status === 'initializing') {
    dot.classList.add('indicator-loading');
    text.textContent = '初期化中...';
    button.disabled = true;
    button.textContent = 'ダウンロード中...';
  } else if (status === 'failed') {
    dot.classList.add('indicator-inactive');
    text.textContent = '初期化失敗';
    button.textContent = '再試行';
  } else {
    dot.classList.add('indicator-inactive');
    text.textContent = message || '未初期化';
  }
}

/**
 * Gemini状態の更新
 */
function updateGeminiStatus(isAvailable, message) {
  const dot = getElement('geminiStatusDot');
  const text = getElement('geminiStatusText');
  
  if (!dot || !text) return;
  
  if (isAvailable) {
    dot.className = 'indicator-dot indicator-active';
  } else {
    dot.className = 'indicator-dot indicator-inactive';
  }
  
  text.textContent = message;
}

/**
 * オートモード状態の更新
 */
function updateAutoModeStatus(isActive) {
  const dot = getElement('autoModeStatusDot');
  const text = getElement('autoModeStatusText');
  
  if (!dot || !text) return;

  if (isActive) {
    dot.className = 'indicator-dot indicator-active';
    text.textContent = '有効';
  } else {
    dot.className = 'indicator-dot indicator-inactive';
    text.textContent = '無効';
  }
}

/**
 * 処理優先順位の更新
 */
function updateProcessingPriority(priority) {
  const priorityElement = getElement('processingPriority');
  if (!priorityElement) return;
  
  if (priority) {
    priorityElement.textContent = priority;
  } else {
    // 設定から動的に生成
    const methods = [];
    const localLlmToggle = getElement('localLlmToggle');
    const geminiToggle = getElement('geminiToggle');
    
    if (localLlmToggle?.classList.contains('active')) {
      methods.push('ローカルLLM');
    }
    if (geminiToggle?.classList.contains('active')) {
      methods.push('Gemini API');
    }
    
    priorityElement.textContent = methods.join(' → ') || '処理方法なし';
  }
}

/**
 * OCRステータス確認
 */
async function checkOCRStatus() {
  try {
    const response = await sendMessageSafely({ action: 'getOCRStatus' }, 5000);
    
    // ローカルLLMステータス
    updateLocalLLMStatus(
      response.localLLMAvailable,
      response.localLLMAvailable ? 'ローカルLLM利用可能' : '未初期化',
      response.localLLMStatus || {}
    );

    // Gemini APIステータス
    updateGeminiStatus(response.geminiAPIAvailable, 
      response.geminiAPIAvailable ? 'Gemini API利用可能' : 'APIキー未設定');

    // 処理優先順位を更新
    updateProcessingPriority(response.currentPriority);

  } catch (error) {
    console.error('OCRステータス確認エラー:', error);
    showNotification('ステータス確認に失敗しました', 'warning', 2000);
  }
}

/**
 * 使用統計の読み込み
 */
async function loadUsageStats() {
  try {
    const response = await sendMessageSafely({ action: 'getUsageStats' }, 3000);
    
    if (response?.success) {
      const stats = response.stats;
      
      const totalProcessed = getElement('totalProcessed');
      const avgTime = getElement('avgTime');
      const localRatio = getElement('localRatio');
      const successRate = getElement('successRate');
      
      if (totalProcessed) totalProcessed.textContent = stats.total || 0;
      if (avgTime) avgTime.textContent = `${stats.averageTime?.['local-llm'] || 0}ms`;
      if (localRatio) {
        const ratio = Math.round((stats.byMethod?.['local-llm'] || 0) / (stats.total || 1) * 100);
        localRatio.textContent = `${ratio}%`;
      }
      if (successRate) successRate.textContent = '100%';
      
      console.log('使用統計を更新しました');
    }
  } catch (error) {
    console.error('統計読み込みエラー:', error);
  }
}

/**
 * APIキー保存
 */
async function saveApiKey() {
  const apiKeyInput = getElement('apiKey');
  const saveApiKeyBtn = getElement('saveApiKey');
  
  if (!apiKeyInput || !saveApiKeyBtn) return;
  
  const apiKey = apiKeyInput.value.trim();
  
  if (!apiKey) {
    showNotification('APIキーを入力してください', 'error');
    return;
  }
  
  if (!apiKey.startsWith('AIza')) {
    showNotification('有効なGemini APIキーを入力してください（AIzaで始まる）', 'error');
    return;
  }
  
  saveApiKeyBtn.disabled = true;
  saveApiKeyBtn.textContent = '保存中...';
  
  try {
    // APIキーをストレージに保存
    await new Promise((resolve, reject) => {
      chrome.storage.local.set({ 'geminiApiKey': apiKey }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
    
    // APIキーの有効性をテスト
    const response = await sendMessageSafely({
      action: 'testApiKey',
      apiKey: apiKey
    }, 15000);
    
    if (response?.success) {
      showNotification('APIキーを保存しました', 'success');
      updateGeminiStatus(true, 'Gemini API利用可能');
      
      // 入力フィールドをセキュアな表示に変更
      apiKeyInput.value = '';
      apiKeyInput.placeholder = 'APIキーは設定済みです（セキュリティのため非表示）';
      apiKeyInput.style.backgroundColor = '#f0f8ff';
    } else {
      throw new Error(response?.error || 'APIキーの検証に失敗しました');
    }
    
  } catch (error) {
    console.error('APIキー保存エラー:', error);
    
    let userMessage = `APIキーの保存に失敗: ${error.message}`;
    if (error.message.includes('タイムアウト')) {
      userMessage = 'APIキーの検証がタイムアウトしました。ネットワーク接続を確認してください。';
    }
    
    showNotification(userMessage, 'error');
    updateGeminiStatus(false, 'APIキーが無効');
  } finally {
    saveApiKeyBtn.disabled = false;
    saveApiKeyBtn.textContent = 'APIキーを保存';
  }
}



// ===== モデル選択マッピングの追加 =====
const MODEL_KEY_MAP = {
  'phi3-mini': {
    webllmName: 'Phi-3-mini-4k-instruct-q4f16_1-MLC',
    displayName: 'Phi-3 Mini',
    size: '2.4GB'
  },
  'llama32-3b': {
    webllmName: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    displayName: 'Llama 3.2 3B',
    size: '2.0GB'
  },
  'llama32-1b': {
    webllmName: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    displayName: 'Llama 3.2 1B',
    size: '800MB'
  },
  'gemma2-2b': {
    webllmName: 'gemma-2-2b-it-q4f16_1-MLC',
    displayName: 'Gemma 2 2B',
    size: '1.6GB'
  }
};

/**
 * ローカルLLM初期化関数の修正版
 */
async function initializeLocalLLM() {
  if (isInitializing) {
    showNotification('初期化中です...', 'info');
    return;
  }
  
  const initializeBtn = getElement('initializeLocalLlm');
  const progressContainer = getElement('modelProgress');
  
  if (!initializeBtn) {
    console.error('初期化ボタンが見つかりません');
    showNotification('UIエラー: 初期化ボタンが見つかりません', 'error');
    return;
  }
  
  console.log('=== ローカルLLM初期化開始 ===');
  console.log('選択されたモデルキー:', selectedModel);
  
  // モデル設定を確認
  const modelConfig = MODEL_KEY_MAP[selectedModel];
  if (!modelConfig) {
    console.error('未対応のモデルキー:', selectedModel);
    showNotification(`未対応のモデル: ${selectedModel}`, 'error');
    return;
  }
  
  isInitializing = true;
  initializeBtn.disabled = true;
  initializeBtn.textContent = '初期化中...';
  
  if (progressContainer) progressContainer.style.display = 'block';
  updateProgress(0);

  try {
    // 環境チェック強化
    console.log('環境チェック開始:');
    console.log('- Chrome runtime available:', !!chrome?.runtime);
    console.log('- Chrome storage available:', !!chrome?.storage);
    console.log('- Extension context valid:', !!chrome?.runtime?.id);
    
    // 拡張機能コンテキストの確認
    if (!chrome?.runtime?.id) {
      throw new Error('拡張機能のコンテキストが無効です。ページを再読み込みしてください。');
    }
    
    // Background Scriptとの通信テスト（改善版）
    console.log('Background script通信テスト開始...');
    try {
      const pingResponse = await sendMessageSafely({
        action: 'getVersionInfo'
      }, 5000, 2); // 5秒タイムアウト、2回リトライ
      
      console.log('Background script応答確認:', pingResponse);
      if (!pingResponse?.success) {
        throw new Error('Background scriptが無効な応答を返しました');
      }
    } catch (pingError) {
      console.error('Background script通信失敗:', pingError);
      throw new Error(`Background scriptとの通信に失敗: ${pingError.message}\n\n対処法: 拡張機能を再読み込みするか、ブラウザを再起動してください。`);
    }
    
    // 設定を先に保存
    console.log('設定保存開始...');
    await new Promise((resolve, reject) => {
      const settingsToSave = {
        'useLocalLLM': true,
        'preferredLocalModel': selectedModel,
        'localLLMInitialized': false,
        'localLLMInitializationStart': Date.now()
      };
      
      chrome.storage.local.set(settingsToSave, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(`設定保存エラー: ${chrome.runtime.lastError.message}`));
        } else {
          console.log('設定保存成功');
          resolve();
        }
      });
    });
    
    // ローカルLLM初期化リクエスト送信（改善版）
    console.log('ローカルLLM初期化リクエスト送信開始...');
    updateProgress(10);
    
    const response = await sendMessageSafely({
      action: 'initializeLocalLLM',
      model: selectedModel
    }, 300000, 1); // 5分タイムアウト、リトライなし（時間がかかるため）

    console.log('Background scriptからの応答:', response);
    
    if (!response) {
      throw new Error('Background scriptから応答がありません - 拡張機能を再読み込みしてください');
    }
    
    if (response.success) {
      console.log('初期化成功レスポンス受信');
      updateProgress(90);
      
      // 初期化成功時の設定保存
      await new Promise((resolve, reject) => {
        const successSettings = {
          'localLLMInitialized': true,
          'localLLMModel': modelConfig.webllmName,
          'preferredLocalModel': selectedModel,
          'localLLMLastInitialized': Date.now()
        };
        
        chrome.storage.local.set(successSettings, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(`成功設定保存エラー: ${chrome.runtime.lastError.message}`));
          } else {
            console.log('成功設定保存完了');
            resolve();
          }
        });
      });
      
      updateLocalLLMStatus(true, 'ローカルLLM利用可能', { 
        status: 'initialized',
        model: modelConfig.webllmName
      });
      showNotification(`${modelConfig.displayName}の初期化が完了しました`, 'success');
      updateProgress(100);
      
      initializationAttempts = 0;
      console.log('=== ローカルLLM初期化成功 ===');
      
    } else {
      // 失敗レスポンスの詳細処理
      console.error('初期化失敗レスポンス:', response);
      
      let errorMessage = response.error || '不明なエラーが発生しました';
      
      // 特定のエラーに対する対処法を追加
      if (response.error && response.error.includes('アクティブなタブが見つかりません')) {
        errorMessage += '\n\n対処法: ブラウザでWebページを開いてから再試行してください。';
      } else if (response.error && response.error.includes('Content script')) {
        errorMessage += '\n\n対処法: ページを再読み込みするか、別のタブで再試行してください。';
      }
      
      throw new Error(errorMessage);
    }
    
  } catch (error) {
    console.error('=== ローカルLLM初期化エラー ===');
    console.error('エラー詳細:', error);
    
    initializationAttempts++;
    
    // エラーの種類別処理
    let userMessage = error.message;
    
    if (error.message.includes('Background script')) {
      userMessage = 'Background scriptとの通信に失敗しました。\n\n対処法:\n1. 拡張機能を再読み込みしてください\n2. ブラウザを再起動してください\n3. 拡張機能を一度無効化→有効化してください';
    } else if (error.message.includes('タイムアウト')) {
      userMessage = 'モデルの読み込みがタイムアウトしました。\n\n対処法:\n1. ネットワーク接続を確認してください\n2. より小さなモデルを選択してください\n3. しばらく待ってから再試行してください';
    } else if (error.message.includes('設定保存')) {
      userMessage = 'ブラウザのストレージへのアクセスに失敗しました。\n\n対処法:\n1. ブラウザを再起動してください\n2. ストレージ容量を確認してください';
    }
    
    // エラー時の設定クリア
    try {
      await new Promise((resolve) => {
        chrome.storage.local.set({
          'localLLMInitialized': false,
          'useLocalLLM': false,
          'localLLMInitializationError': error.message,
          'localLLMErrorTimestamp': Date.now()
        }, () => {
          console.log('エラー設定保存完了');
          resolve();
        });
      });
    } catch (storageError) {
      console.warn('エラー設定保存失敗:', storageError);
    }
    
    updateLocalLLMStatus(false, `初期化失敗: ${error.message}`, { 
      status: 'failed', 
      error: error.message
    });
    
    // リトライ可能な場合は案内
    if (initializationAttempts < MAX_INIT_ATTEMPTS) {
      showNotification(`初期化失敗（${initializationAttempts}/${MAX_INIT_ATTEMPTS}回目）: ${userMessage}`, 'error', 10000);
    } else {
      showNotification(`初期化に複数回失敗しました: ${userMessage}`, 'error', 15000);
    }
    
  } finally {
    console.log('=== 初期化処理終了 ===');
    isInitializing = false;
    if (initializeBtn) {
      initializeBtn.disabled = false;
      initializeBtn.textContent = 'ローカルLLMを初期化';
    }
    
    if (progressContainer) {
      setTimeout(() => {
        progressContainer.style.display = 'none';
      }, 3000);
    }
  }
}
/**
 * プログレス更新
 */
function updateProgress(percent) {
  const progressBar = getElement('progressBar');
  if (progressBar) {
    progressBar.style.width = `${percent}%`;
    progressBar.textContent = `${Math.round(percent)}%`;
  }
}

/**
 * OCRテスト実行
 */
async function testOCR() {
  const testOcrBtn = getElement('testOcr');
  if (!testOcrBtn) return;
  
  testOcrBtn.disabled = true;
  testOcrBtn.textContent = 'テスト中...';
  
  try {
    const response = await sendMessageSafely({
      action: 'testOCR',
      testType: 'simple'
    }, 15000);
    
    if (response?.success) {
      showNotification(`OCRテスト成功: ${response.method} (${response.time}ms)`, 'success');
    } else {
      const errorMsg = response?.error || 'テストが失敗しました';
      showNotification(`OCRテスト失敗: ${errorMsg}`, 'error');
    }
  } catch (error) {
    console.error('OCRテストエラー:', error);
    showNotification(`OCRテストエラー: ${error.message}`, 'error');
  } finally {
    testOcrBtn.disabled = false;
    testOcrBtn.textContent = 'OCRテスト実行';
  }
}

/**
 * キャッシュクリア
 */
async function clearCache() {
  try {
    const response = await sendMessageSafely({ action: 'clearCache' }, 3000);
    if (response?.success) {
      showNotification('キャッシュをクリアしました', 'success');
    }
  } catch (error) {
    console.error('キャッシュクリアエラー:', error);
    showNotification('キャッシュクリアに失敗しました', 'error');
  }
}

/**
 * イベントリスナー設定
 */
function setupEventListeners() {
  console.log('イベントリスナーを設定中...');
  
  try {
    // トグルボタンの設定
    const localLlmToggle = getElement('localLlmToggle');
    const geminiToggle = getElement('geminiToggle');
    const autoModeToggle = getElement('autoModeToggle');
    
    if (localLlmToggle) {
      localLlmToggle.addEventListener('click', () => {
        const isActive = localLlmToggle.classList.toggle('active');
        chrome.storage.local.set({ 'useLocalLLM': isActive });
        updateIndicator(localLlmToggle.parentElement?.querySelector('.mode-indicator'), isActive);
        updateProcessingPriority();
      });
    }

    if (geminiToggle) {
      geminiToggle.addEventListener('click', () => {
        const isActive = geminiToggle.classList.toggle('active');
        chrome.storage.local.set({ 'fallbackToGemini': isActive });
        updateIndicator(geminiToggle.parentElement?.querySelector('.mode-indicator'), isActive);
        
        const geminiSettings = getElement('geminiSettings');
        if (geminiSettings) {
          geminiSettings.style.display = isActive ? 'block' : 'none';
        }
        updateProcessingPriority();
      });
    }

    if (autoModeToggle) {
      autoModeToggle.addEventListener('click', () => {
        const isActive = autoModeToggle.classList.toggle('active');
        chrome.storage.local.set({ 'ocrAutoMode': isActive });
        updateAutoModeStatus(isActive);
        showNotification(
          isActive ? 'オートマチックモードを有効にしました' : 'オートマチックモードを無効にしました', 
          'success'
        );
      });
    }

    // APIキー表示/非表示切り替え
    const toggleVisibilityBtn = getElement('toggleVisibility');
    const apiKeyInput = getElement('apiKey');
    
    if (toggleVisibilityBtn && apiKeyInput) {
      toggleVisibilityBtn.addEventListener('click', () => {
        if (apiKeyInput.type === 'password') {
          apiKeyInput.type = 'text';
          toggleVisibilityBtn.textContent = '🔒';
        } else {
          apiKeyInput.type = 'password';
          toggleVisibilityBtn.textContent = '👁️';
        }
      });
    }

    // APIキー保存
    const saveApiKeyBtn = getElement('saveApiKey');
    if (saveApiKeyBtn) {
      saveApiKeyBtn.addEventListener('click', saveApiKey);
    }

    // Geminiモデル選択
    const geminiModelSelect = getElement('geminiModel');
    if (geminiModelSelect) {
      geminiModelSelect.addEventListener('change', () => {
        chrome.storage.local.set({ 'geminiModel': geminiModelSelect.value });
        showNotification('Geminiモデルを更新しました', 'success');
      });
    }

    // 処理モード選択
    const modeRadios = document.querySelectorAll('input[name="ocrMode"]');
    modeRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        chrome.storage.local.set({ 'ocrMode': radio.value });
        showNotification('処理モードを更新しました', 'success');
      });
    });

    // Gemini APIテスト
    const testGeminiApiBtn = getElement('testGeminiApi');
    if (testGeminiApiBtn) {
      testGeminiApiBtn.addEventListener('click', async () => {
        testGeminiApiBtn.disabled = true;
        testGeminiApiBtn.textContent = 'テスト中...';
        
        try {
          const result = await new Promise((resolve) => {
            chrome.storage.local.get(['geminiApiKey'], resolve);
          });
          
          if (!result.geminiApiKey) {
            throw new Error('APIキーが設定されていません');
          }
          
          const response = await sendMessageSafely({
            action: 'testApiKey',
            apiKey: result.geminiApiKey
          }, 10000);
          
          if (response?.success) {
            showNotification('Gemini API接続テスト成功', 'success');
            updateGeminiStatus(true, 'Gemini API利用可能');
          } else {
            throw new Error(response?.error || 'API接続テストに失敗');
          }
          
        } catch (error) {
          showNotification(`API接続テスト失敗: ${error.message}`, 'error');
          updateGeminiStatus(false, error.message);
        } finally {
          testGeminiApiBtn.disabled = false;
          testGeminiApiBtn.textContent = 'Gemini API接続テスト';
        }
      });
    }

    // モデル選択
    const modelCards = document.querySelectorAll('.model-card');
    modelCards.forEach(card => {
      card.addEventListener('click', async () => {
        modelCards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedModel = card.dataset.model;
        
        // 即座に設定を保存
        try {
          await new Promise((resolve, reject) => {
            chrome.storage.local.set({ 'preferredLocalModel': selectedModel }, () => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve();
              }
            });
          });
          
          console.log('モデル選択を保存しました:', selectedModel);
          showNotification(`モデル「${card.querySelector('.model-name').textContent}」を選択しました`, 'info', 2000);
        } catch (error) {
          console.error('モデル選択保存エラー:', error);
        }
      });
    });

    // ローカルLLM初期化
    const initializeLocalLlmBtn = getElement('initializeLocalLlm');
    if (initializeLocalLlmBtn) {
      initializeLocalLlmBtn.addEventListener('click', initializeLocalLLM);
    }

    // 統計更新
    const refreshStatsBtn = getElement('refreshStats');
    if (refreshStatsBtn) {
      refreshStatsBtn.addEventListener('click', loadUsageStats);
    }

    // OCRテスト
    const testOcrBtn = getElement('testOcr');
    if (testOcrBtn) {
      testOcrBtn.addEventListener('click', testOCR);
    }

    // キャッシュクリア
    const clearCacheBtn = getElement('clearCache');
    if (clearCacheBtn) {
      clearCacheBtn.addEventListener('click', clearCache);
    }

    // 言語変更の監視
    const languageSelect = getElement('language');
    if (languageSelect) {
      languageSelect.addEventListener('change', function() {
        chrome.storage.local.set({ 'ocrLanguage': this.value });
        showNotification('言語設定を更新しました', 'success', 2000);
      });
    }

    // プログレス更新を監視
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "updateModelProgress") {
        updateProgress(request.progress);
      }
    });

    console.log('イベントリスナー設定完了');
  } catch (error) {
    console.error('イベントリスナー設定エラー:', error);
    showNotification('一部の機能が正常に動作しない可能性があります', 'warning');
  }
}

/**
 * 拡張機能の健全性チェック（改善版）
 */
async function performHealthCheck() {
  console.log('拡張機能健全性チェック開始');
  
  const healthStatus = {
    runtimeValid: false,
    backgroundScript: false,
    storage: false,
    permissions: false
  };
  
  try {
    // 1. Runtime context の確認
    try {
      healthStatus.runtimeValid = !!(chrome?.runtime?.id);
      console.log('Runtime context:', healthStatus.runtimeValid ? 'Valid' : 'Invalid');
    } catch (error) {
      console.warn('Runtime context確認エラー:', error);
    }
    
    // 2. Background script との通信確認
    try {
      const bgResponse = await sendMessageSafely({ action: 'getVersionInfo' }, 3000, 1);
      healthStatus.backgroundScript = !!(bgResponse?.success);
      console.log('Background script:', healthStatus.backgroundScript ? 'OK' : 'NG');
    } catch (error) {
      console.warn('Background script通信エラー:', error);
    }
    
    // 3. ストレージアクセス確認
    try {
      const testKey = 'healthCheck_' + Date.now();
      await new Promise((resolve, reject) => {
        chrome.storage.local.set({ [testKey]: Date.now() }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            // 読み込みテスト
            chrome.storage.local.get([testKey], (result) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                // クリーンアップ
                chrome.storage.local.remove([testKey]);
                resolve(result);
              }
            });
          }
        });
      });
      
      healthStatus.storage = true;
      console.log('Storage access: OK');
    } catch (error) {
      console.warn('ストレージアクセスエラー:', error);
    }
    
    // 4. 権限確認
    try {
      const tabs = await new Promise((resolve, reject) => {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(tabs);
          }
        });
      });
      healthStatus.permissions = !!(tabs && tabs.length > 0);
      console.log('Permissions: OK');
    } catch (error) {
      console.warn('権限確認エラー:', error);
    }
    
    console.log('健全性チェック結果:', healthStatus);
    
    // 問題がある場合は警告
    const issues = Object.entries(healthStatus)
      .filter(([key, value]) => !value)
      .map(([key]) => key);
    
    if (issues.length > 0) {
      console.warn('検出された問題:', issues);
      
      let message = '拡張機能に問題が検出されました:\n';
      if (!healthStatus.runtimeValid) message += '• Runtime context が無効\n';
      if (!healthStatus.backgroundScript) message += '• Background script が応答しない\n';
      if (!healthStatus.storage) message += '• ストレージアクセスに問題\n';
      if (!healthStatus.permissions) message += '• 権限に問題\n';
      
      message += '\n対処法: 拡張機能を再読み込みするか、ブラウザを再起動してください。';
      
      showNotification(message, 'warning', 8000);
    }
    
    return healthStatus;
    
  } catch (error) {
    console.error('健全性チェックエラー:', error);
    return healthStatus;
  }
}

/**
 * 定期的なステータス更新
 */
function startPeriodicStatusUpdate() {
  // 10秒間隔でステータスを更新
  const statusUpdateInterval = setInterval(async () => {
    try {
      await checkOCRStatus();
    } catch (error) {
      console.warn('定期ステータス更新エラー:', error);
    }
  }, 10000);
  
  // ページ離脱時にクリーンアップ
  window.addEventListener('beforeunload', () => {
    clearInterval(statusUpdateInterval);
  });
  
  console.log('定期ステータス更新を開始しました（10秒間隔）');
}

/**
 * 初期化失敗時の復旧処理
 */
function handleInitializationFailure(error) {
  console.error('初期化失敗:', error);
  
  // ユーザーに分かりやすいエラーメッセージ
  let userMessage = '設定の読み込みに失敗しました。';
  
  if (error.message.includes('storage')) {
    userMessage += 'ストレージアクセスに問題があります。';
  } else if (error.message.includes('permission')) {
    userMessage += '拡張機能の権限に問題があります。';
  } else if (error.message.includes('network')) {
    userMessage += 'ネットワーク接続に問題があります。';
  }
  
  userMessage += ' ページを再読み込みして再試行してください。';
  
  showNotification(userMessage, 'error', 8000);
  
  // 復旧ボタンを表示
  showRecoveryOptions();
}

/**
 * デバッグ情報の表示とエクスポート
 */
async function showDebugInfo() {
  try {
    const debugResponse = await sendMessageSafely({ action: 'getDebugInfo' }, 5000);
    
    const debugInfo = {
      timestamp: new Date().toISOString(),
      popup: {
        selectedModel: selectedModel,
        isInitializing: isInitializing,
        initializationAttempts: initializationAttempts,
        elements: Object.keys(elements).filter(key => elements[key] !== null)
      },
      browser: {
        userAgent: navigator.userAgent,
        webGL: !!window.WebGLRenderingContext,
        webGL2: !!window.WebGL2RenderingContext,
        sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
        crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false,
        chrome: {
          runtime: !!chrome?.runtime,
          storage: !!chrome?.storage,
          tabs: !!chrome?.tabs
        }
      },
      background: debugResponse?.debugInfo || null
    };
    
    // デバッグ情報をコンソールに出力
    console.log('=== 完全なデバッグ情報 ===');
    console.log(JSON.stringify(debugInfo, null, 2));
    
    // デバッグ情報をクリップボードにコピー
    try {
      await navigator.clipboard.writeText(JSON.stringify(debugInfo, null, 2));
      showNotification('デバッグ情報をクリップボードにコピーしました', 'success');
    } catch (clipboardError) {
      console.warn('クリップボードコピー失敗:', clipboardError);
      showNotification('デバッグ情報をコンソールに出力しました', 'info');
    }
    
    return debugInfo;
  } catch (error) {
    console.error('デバッグ情報取得エラー:', error);
    showNotification('デバッグ情報の取得に失敗しました', 'error');
    return null;
  }
}

/**
 * ローカルLLMの詳細ステータスチェック
 */
async function checkLocalLLMDetailedStatus() {
  console.log('=== ローカルLLM詳細ステータスチェック ===');
  
  try {
    // ストレージから状態を確認
    const storageStatus = await new Promise((resolve) => {
      chrome.storage.local.get([
        'localLLMInitialized', 
        'localLLMModel', 
        'localLLMInitializationError',
        'localLLMDebugInfo',
        'useLocalLLM'
      ], resolve);
    });
    
    console.log('ストレージ状態:', storageStatus);
    
    // Background scriptから状態を確認
    const runtimeStatus = await sendMessageSafely({
      action: 'getOCRStatus'
    }, 5000);
    
    console.log('Runtime状態:', runtimeStatus);
    
    // Content scriptから状態を確認（アクティブタブがある場合）
    let contentStatus = null;
    try {
      const tabs = await new Promise((resolve) => {
        chrome.tabs.query({active: true, currentWindow: true}, resolve);
      });
      
      if (tabs && tabs.length > 0) {
        contentStatus = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'getLocalLLMStatus'
          }, (response) => {
            if (chrome.runtime.lastError) {
              resolve(null);
            } else {
              resolve(response);
            }
          });
          
          // 2秒でタイムアウト
          setTimeout(() => resolve(null), 2000);
        });
      }
    } catch (tabError) {
      console.warn('Content script状態取得エラー:', tabError);
    }
    
    console.log('Content script状態:', contentStatus);
    
    return {
      storage: storageStatus,
      runtime: runtimeStatus,
      content: contentStatus
    };
    
  } catch (error) {
    console.error('詳細ステータスチェックエラー:', error);
    return null;
  }
}

/**
 * 復旧処理の実行
 */
async function performRecovery() {
  console.log('=== 復旧処理開始 ===');
  
  try {
    // 1. ストレージの状態をクリア
    await new Promise((resolve) => {
      chrome.storage.local.remove([
        'localLLMInitialized',
        'localLLMInitializationError', 
        'localLLMDebugInfo',
        'localLLMModel'
      ], resolve);
    });
    
    console.log('ストレージクリア完了');
    
    // 2. UI状態をリセット
    updateLocalLLMStatus(false, '復旧処理完了', { status: 'recovery' });
    
    // 3. 初期化試行回数をリセット
    initializationAttempts = 0;
    isInitializing = false;
    
    console.log('UI状態リセット完了');
    
    showNotification('復旧処理が完了しました。再度初期化を試行してください。', 'success');
    
  } catch (error) {
    console.error('復旧処理エラー:', error);
    showNotification('復旧処理に失敗しました', 'error');
  }
}

/**
 * 復旧オプションの表示（デバッグ機能付き）
 */
function showRecoveryOptions() {
  const recoveryDiv = document.createElement('div');
  recoveryDiv.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: white;
    padding: 20px;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    z-index: 10001;
    text-align: center;
    min-width: 350px;
    max-width: 90vw;
    border: 2px solid #1a73e8;
    max-height: 80vh;
    overflow-y: auto;
  `;
  
  recoveryDiv.innerHTML = `
    <h3 style="margin: 0 0 15px 0; color: #1a73e8;">ローカルLLM初期化エラー</h3>
    <p style="margin: 0 0 20px 0; text-align: left;">
      ローカルLLMの初期化に失敗しました。以下のオプションから選択してください：
    </p>
    <div style="display: grid; gap: 10px; margin-bottom: 20px;">
      <button id="showDebugInfo" style="padding: 8px 16px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer;">
        🔍 デバッグ情報を表示
      </button>
      <button id="checkDetailedStatus" style="padding: 8px 16px; background: #FF9800; color: white; border: none; border-radius: 4px; cursor: pointer;">
        📊 詳細ステータス確認
      </button>
      <button id="performRecovery" style="padding: 8px 16px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;">
        🔧 復旧処理実行
      </button>
      <button id="retryInit" style="padding: 8px 16px; background: #1a73e8; color: white; border: none; border-radius: 4px; cursor: pointer;">
        🔄 再試行
      </button>
      <button id="resetSettings" style="padding: 8px 16px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">
        ⚠️ 設定リセット
      </button>
      <button id="closeRecovery" style="padding: 8px 16px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">
        ❌ 閉じる
      </button>
    </div>
    <div id="debugOutput" style="text-align: left; background: #f5f5f5; padding: 10px; border-radius: 4px; font-family: monospace; font-size: 12px; max-height: 200px; overflow-y: auto; display: none;">
    </div>
  `;
  
  document.body.appendChild(recoveryDiv);
  
  // イベントリスナー
  document.getElementById('showDebugInfo').addEventListener('click', async () => {
    const debugOutput = document.getElementById('debugOutput');
    debugOutput.style.display = 'block';
    debugOutput.textContent = 'デバッグ情報を取得中...';
    
    const debugInfo = await showDebugInfo();
    if (debugInfo) {
      debugOutput.textContent = JSON.stringify(debugInfo, null, 2);
    } else {
      debugOutput.textContent = 'デバッグ情報の取得に失敗しました';
    }
  });
  
  document.getElementById('checkDetailedStatus').addEventListener('click', async () => {
    const debugOutput = document.getElementById('debugOutput');
    debugOutput.style.display = 'block';
    debugOutput.textContent = '詳細ステータスを確認中...';
    
    const status = await checkLocalLLMDetailedStatus();
    if (status) {
      debugOutput.textContent = JSON.stringify(status, null, 2);
    } else {
      debugOutput.textContent = '詳細ステータスの取得に失敗しました';
    }
  });
  
  document.getElementById('performRecovery').addEventListener('click', async () => {
    await performRecovery();
  });
  
  document.getElementById('retryInit').addEventListener('click', () => {
    document.body.removeChild(recoveryDiv);
    initializeLocalLLM();
  });
  
  document.getElementById('resetSettings').addEventListener('click', async () => {
    try {
      await new Promise((resolve, reject) => {
        chrome.storage.local.clear(() => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
      showNotification('設定をリセットしました', 'success');
      setTimeout(() => window.location.reload(), 1000);
    } catch (error) {
      showNotification('設定リセットに失敗しました', 'error');
    }
  });
  
  document.getElementById('closeRecovery').addEventListener('click', () => {
    document.body.removeChild(recoveryDiv);
  });
}/**
 * エラー追跡とレポート機能
 */
class ErrorTracker {
  constructor() {
    this.errors = [];
    this.maxErrors = 50;
  }
  
  addError(error, context = '') {
    const errorEntry = {
      timestamp: new Date().toISOString(),
      message: error.message,
      stack: error.stack,
      context: context,
      userAgent: navigator.userAgent,
      url: window.location.href
    };
    
    this.errors.unshift(errorEntry);
    
    // 最大件数を超えた場合は古いエラーを削除
    if (this.errors.length > this.maxErrors) {
      this.errors = this.errors.slice(0, this.maxErrors);
    }
    
    console.error('エラー追跡:', errorEntry);
  }
  
  getErrorReport() {
    return {
      errorCount: this.errors.length,
      errors: this.errors,
      browserInfo: {
        userAgent: navigator.userAgent,
        webGL: !!window.WebGLRenderingContext,
        webGL2: !!window.WebGL2RenderingContext,
        sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
        crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false
      }
    };
  }
  
  clearErrors() {
    this.errors = [];
  }
}

// グローバルエラートラッカー
const errorTracker = new ErrorTracker();

/**
 * グローバルエラーハンドラーの設定
 */
function setupGlobalErrorHandlers() {
  // 未処理のエラーをキャッチ
  window.addEventListener('error', (event) => {
    errorTracker.addError(event.error || new Error(event.message), `Global error: ${event.filename}:${event.lineno}`);
  });
  
  // 未処理のPromise rejectionをキャッチ
  window.addEventListener('unhandledrejection', (event) => {
    errorTracker.addError(new Error(event.reason), 'Unhandled promise rejection');
  });
  
  console.log('グローバルエラーハンドラーを設定しました');
}

/**
 * OCRテスト実行（エラーハンドリング強化版）
 */
async function testOCR() {
  const testOcrBtn = getElement('testOcr');
  if (!testOcrBtn) return;
  
  testOcrBtn.disabled = true;
  testOcrBtn.textContent = 'テスト中...';
  
  try {
    console.log('=== OCRテスト開始 ===');
    
    // 環境チェック
    const envCheck = {
      chromeRuntime: !!chrome?.runtime,
      chromeStorage: !!chrome?.storage,
      chromeTabs: !!chrome?.tabs
    };
    
    console.log('環境チェック:', envCheck);
    
    if (!envCheck.chromeRuntime) {
      throw new Error('Chrome拡張APIが利用できません');
    }
    
    const response = await sendMessageSafely({
      action: 'testOCR',
      testType: 'simple'
    }, 15000);
    
    console.log('OCRテスト応答:', response);
    
    if (response?.success) {
      showNotification(`OCRテスト成功: ${response.method} (${response.time}ms)`, 'success');
      console.log('=== OCRテスト成功 ===');
    } else {
      const errorMsg = response?.error || 'テストが失敗しました';
      throw new Error(errorMsg);
    }
  } catch (error) {
    console.error('=== OCRテストエラー ===');
    console.error('エラー詳細:', error);
    
    errorTracker.addError(error, 'OCR Test');
    
    let userMessage = `OCRテストエラー: ${error.message}`;
    
    // エラーの種類に応じたガイダンス
    if (error.message.includes('タイムアウト')) {
      userMessage += '\n→ ネットワーク接続を確認してください';
    } else if (error.message.includes('Chrome拡張API')) {
      userMessage += '\n→ 拡張機能を再読み込みしてください';
    } else if (error.message.includes('Background script')) {
      userMessage += '\n→ Background scriptが応答していません';
    }
    
    showNotification(userMessage, 'error');
  } finally {
    testOcrBtn.disabled = false;
    testOcrBtn.textContent = 'OCRテスト実行';
  }
}

/**
 * 詳細なブラウザ環境情報の取得
 */
function getBrowserEnvironmentInfo() {
  const info = {
    // 基本情報
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    
    // WebGL情報
    webGL: {
      available: !!window.WebGLRenderingContext,
      webGL2: !!window.WebGL2RenderingContext,
      context: null
    },
    
    // Web API サポート
    apis: {
      sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false,
      webAssembly: typeof WebAssembly !== 'undefined',
      workers: typeof Worker !== 'undefined',
      serviceWorker: 'serviceWorker' in navigator,
      indexedDB: 'indexedDB' in window,
      localStorage: 'localStorage' in window
    },
    
    // Chrome拡張API
    chrome: {
      runtime: !!chrome?.runtime,
      storage: !!chrome?.storage,
      tabs: !!chrome?.tabs,
      scripting: !!chrome?.scripting
    },
    
    // メモリ情報（利用可能な場合）
    memory: navigator.deviceMemory || 'unknown',
    
    // 画面情報
    screen: {
      width: screen.width,
      height: screen.height,
      devicePixelRatio: window.devicePixelRatio
    }
  };
  
  // WebGLコンテキスト情報を取得
  try {
    if (info.webGL.available) {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        info.webGL.context = {
          vendor: gl.getParameter(gl.VENDOR),
          renderer: gl.getParameter(gl.RENDERER),
          version: gl.getParameter(gl.VERSION),
          shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
          maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
          maxViewportDims: gl.getParameter(gl.MAX_VIEWPORT_DIMS)
        };
      }
    }
  } catch (webglError) {
    info.webGL.error = webglError.message;
  }
  
  return info;
}

/**
 * 初期化失敗時の処理（詳細診断付き）
 */
function handleInitializationFailure(error) {
  console.error('=== 初期化失敗の詳細診断 ===');
  console.error('初期化失敗:', error);
  
  // エラーを追跡
  errorTracker.addError(error, 'Initialization');
  
  // 環境情報を取得
  const envInfo = getBrowserEnvironmentInfo();
  console.log('ブラウザ環境情報:', envInfo);
  
  // 診断結果の生成
  const diagnostics = [];
  
  if (!envInfo.chrome.runtime) {
    diagnostics.push('Chrome拡張APIが利用できません');
  }
  
  if (!envInfo.apis.webAssembly) {
    diagnostics.push('WebAssemblyがサポートされていません');
  }
  
  if (!envInfo.webGL.available) {
    diagnostics.push('WebGLがサポートされていません');
  }
  
  if (!envInfo.apis.sharedArrayBuffer) {
    diagnostics.push('SharedArrayBufferが利用できません（セキュリティヘッダーが必要な場合があります）');
  }
  
  if (!envInfo.apis.crossOriginIsolated) {
    diagnostics.push('Cross-Origin Isolationが有効ではありません');
  }
  
  // ユーザーに分かりやすいエラーメッセージ
  let userMessage = '拡張機能の初期化に失敗しました。';
  
  if (error.message.includes('storage')) {
    userMessage += '\n原因: ストレージアクセスエラー';
    diagnostics.push('ブラウザのストレージ機能に問題があります');
  } else if (error.message.includes('permission')) {
    userMessage += '\n原因: 権限エラー';
    diagnostics.push('拡張機能の権限設定に問題があります');
  } else if (error.message.includes('network')) {
    userMessage += '\n原因: ネットワークエラー';
    diagnostics.push('ネットワーク接続に問題があります');
  }
  
  if (diagnostics.length > 0) {
    console.warn('診断結果:', diagnostics);
    userMessage += `\n\n診断結果:\n${diagnostics.join('\n')}`;
  }
  
  userMessage += '\n\n詳細情報はコンソールを確認してください。';
  
  showNotification(userMessage, 'error', 10000);
  
  // 復旧オプションを表示
  showRecoveryOptions();
}

/**
 * メイン初期化処理（エラーハンドリング強化版）
 */
async function initializePopup() {
  console.log('=== Popup初期化開始 ===');
  
  try {
    // グローバルエラーハンドラーを設定
    setupGlobalErrorHandlers();
    
    // 環境情報をログ出力
    const envInfo = getBrowserEnvironmentInfo();
    console.log('ブラウザ環境情報:', envInfo);
    
    // Chrome拡張APIの基本チェック
    if (!chrome?.runtime) {
      throw new Error('Chrome拡張APIが利用できません。拡張機能が正しくインストールされているか確認してください。');
    }
    
    // ステップ1: 設定を読み込み
    console.log('STEP 1: 設定読み込み');
    await loadSettings();
    
    // ステップ2: OCRステータス確認
    console.log('STEP 2: OCRステータス確認');
    await checkOCRStatus();
    
    // ステップ3: 使用統計読み込み
    console.log('STEP 3: 使用統計読み込み');
    await loadUsageStats();
    
    // ステップ4: イベントリスナー設定
    console.log('STEP 4: イベントリスナー設定');
    setupEventListeners();
    
    // ステップ5: 健全性チェック
    console.log('STEP 5: 健全性チェック');
    await performHealthCheck();
    
    // ステップ6: 定期更新開始
    console.log('STEP 6: 定期更新開始');
    startPeriodicStatusUpdate();
    
    // ステップ7: 初期化完了
    console.log('STEP 7: 初期化完了');
    document.body.classList.add('initialization-complete');
    
    // デバッグモードの場合は状態表示
    if (window.location.href.includes('debug=true')) {
      showInitializationStatus();
    }
    
    console.log('🎉 popup.js 初期化完了');
    showNotification('拡張機能の初期化が完了しました', 'success', 2000);
    
  } catch (error) {
    console.error('=== 初期化中にエラーが発生 ===');
    console.error('エラー詳細:', error);
    console.error('エラースタック:', error.stack);
    
    handleInitializationFailure(error);
    setupBasicEventListeners();
  }
}

// DOMContentLoaded イベントリスナー
document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM読み込み完了 - 初期化開始');
  
  // 初期化を実行
  initializePopup();
});

// ページ離脱時のクリーンアップ
window.addEventListener('beforeunload', () => {
  console.log('ページ離脱 - クリーンアップ実行');
  isInitializing = false;
});

// ページ可視性変更時の処理
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') {
    console.log('タブがアクティブになりました - 状態チェック');
    
    setTimeout(() => {
      if (document.body.classList.contains('initialization-complete')) {
        checkOCRStatus().catch(console.warn);
      }
    }, 100);
  }
});

// エラートラッキング用のグローバル関数
window.getErrorReport = () => errorTracker.getErrorReport();
window.clearErrors = () => errorTracker.clearErrors();
window.showDebugInfo = showDebugInfo;
window.checkLocalLLMDetailedStatus = checkLocalLLMDetailedStatus;

// 必要なCSSアニメーションを追加
const popupStyles = document.createElement('style');
popupStyles.textContent = `
  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }
  
  @keyframes slideOut {
    from {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    to {
      opacity: 0;
      transform: translateX(-50%) translateY(-10px);
    }
  }
  
  .debug-button {
    position: fixed;
    bottom: 10px;
    right: 10px;
    background: #2196F3;
    color: white;
    border: none;
    border-radius: 50%;
    width: 40px;
    height: 40px;
    cursor: pointer;
    font-size: 18px;
    z-index: 10000;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }
  
  .debug-button:hover {
    background: #1976D2;
  }
`;
document.head.appendChild(popupStyles);

// デバッグボタンを追加（開発時のみ）
if (window.location.href.includes('debug=true')) {
  const debugButton = document.createElement('button');
  debugButton.className = 'debug-button';
  debugButton.innerHTML = '🔧';
  debugButton.title = 'デバッグ情報を表示';
  debugButton.onclick = showRecoveryOptions;
  document.body.appendChild(debugButton);
}

/**
 * 基本的なイベントリスナーのみ設定（エラー時のフォールバック）
 */
function setupBasicEventListeners() {
  console.log('基本イベントリスナーのみ設定');
  
  try {
    const saveBtn = getElement('saveApiKey');
    if (saveBtn) {
      saveBtn.addEventListener('click', saveApiKey);
    }
    
    const testBtn = getElement('testOcr');
    if (testBtn) {
      testBtn.addEventListener('click', testOCR);
    }
    
    const initBtn = getElement('initializeLocalLlm');
    if (initBtn) {
      initBtn.addEventListener('click', initializeLocalLLM);
    }
    
    console.log('基本イベントリスナー設定完了');
  } catch (error) {
    console.error('基本イベントリスナー設定エラー:', error);
  }
}

/**
 * 初期化状態の表示（デバッグ用）
 */
function showInitializationStatus() {
  const debugInfo = {
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    chromeVersion: /Chrome\/([0-9.]+)/.exec(navigator.userAgent)?.[1] || 'unknown',
    extensionVersion: chrome.runtime.getManifest().version,
    localLLMStatus: getElement('localLlmStatusText')?.textContent || 'unknown',
    geminiStatus: getElement('geminiStatusText')?.textContent || 'unknown'
  };
  
  console.log('=== 初期化状態デバッグ情報 ===');
  console.table(debugInfo);
}

/**
 * メイン初期化処理
 */
async function initializePopup() {
  console.log('Popup初期化開始');
  
  try {
    // ステップ1: 設定を読み込み
    console.log('STEP 1: 設定読み込み');
    await loadSettings();
    
    // ステップ2: OCRステータス確認
    console.log('STEP 2: OCRステータス確認');
    await checkOCRStatus();
    
    // ステップ3: 使用統計読み込み
    console.log('STEP 3: 使用統計読み込み');
    await loadUsageStats();
    
    // ステップ4: イベントリスナー設定
    console.log('STEP 4: イベントリスナー設定');
    setupEventListeners();
    
    // ステップ5: 健全性チェック
    console.log('STEP 5: 健全性チェック');
    await performHealthCheck();
    
    // ステップ6: 定期更新開始
    console.log('STEP 6: 定期更新開始');
    startPeriodicStatusUpdate();
    
    // ステップ7: 初期化完了
    console.log('STEP 7: 初期化完了');
    document.body.classList.add('initialization-complete');
    
    // デバッグモードの場合は状態表示
    if (window.location.href.includes('debug=true')) {
      showInitializationStatus();
    }
    
    console.log('🎉 popup.js 初期化完了');
    showNotification('拡張機能の初期化が完了しました', 'success', 2000);
    
  } catch (error) {
    console.error('初期化中にエラーが発生:', error);
    handleInitializationFailure(error);
    setupBasicEventListeners();
  }
}

// DOMContentLoaded イベントリスナー
document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM読み込み完了 - 初期化開始');
  
  // 初期化を実行
  initializePopup();
});

// ページ離脱時のクリーンアップ
window.addEventListener('beforeunload', () => {
  console.log('ページ離脱 - クリーンアップ実行');
  isInitializing = false;
});

// ページ可視性変更時の処理
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') {
    console.log('タブがアクティブになりました - 状態チェック');
    
    setTimeout(() => {
      if (document.body.classList.contains('initialization-complete')) {
        checkOCRStatus().catch(console.warn);
      }
    }, 100);
  }
});

// 必要なCSSアニメーションを追加
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }
  
  @keyframes slideOut {
    from {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    to {
      opacity: 0;
      transform: translateX(-50%) translateY(-10px);
    }
  }
`;
document.head.appendChild(style);