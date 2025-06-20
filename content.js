(function() {
  // グローバル変数
  let selectionModeActive = false;
  let isSelecting = false;
  let startX = 0;
  let startY = 0;
  let selectionBox = null;
    // ===== 追加: グローバルOCRロック機構 =====
if (!window.globalOcrLock) {
  window.globalOcrLock = {
    isLocked: false,
    
    // ロックを取得（成功時true、失敗時false）
    acquire: function() {
      if (this.isLocked) {
        console.log('OCR処理中のため新しい処理をスキップ');
        return false;
      }
      this.isLocked = true;
      console.log('OCR処理ロックを取得');
      
      // 安全のための自動解除（10秒後）
      setTimeout(() => {
        if (this.isLocked) {
          console.log('OCR処理ロックの自動解除');
          this.release();
        }
      }, 10000);
      
      return true;
    },
    
    // ロックを解除
    release: function() {
      if (this.isLocked) {
        this.isLocked = false;
        console.log('OCR処理ロックを解除');
      }
    },
    
    // 現在の状態を確認
    isProcessing: function() {
      return this.isLocked;
    }
  };
}

  // =========================================
  // サイト固有の設定を確認
  const currentHost = window.location.hostname;
  const isStreamedUp = currentHost.includes('streamedup.com');
  
  // DOM要素のキャッシュ
  const elementCache = {};

  // 要素検索の効率化
  function findViewerElement() {
    // キャッシュ済みならそのまま返す
    if (elementCache.viewer) return elementCache.viewer;
    
    // シンプルなセレクタリスト - 優先度順
    const selectors = [
      '#viewer-container',
      '.viewer-container',
      '.verification-image-container',
      '.receipt-image-container'
    ];
    
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        // 見つかった要素をキャッシュして返す
        elementCache.viewer = element;
        return element;
      }
    }
    
    return null;
  }

  function findImageElement() {
   if (elementCache.image && isValidImage(elementCache.image)) {
    return elementCache.image;
  }
  
  // キャッシュをクリア（無効になったため）
  elementCache.image = null;
  
  const viewer = findViewerElement();
  if (viewer) {
    const image = viewer.querySelector('img');
    if (image && isValidImage(image)) {
      elementCache.image = image;
      return image;
    }
  }
  
  let maxWidth = 0;
  let largestValidImage = null;
  
  document.querySelectorAll('img').forEach(img => {
    if (!isValidImage(img)) return; // 有効性チェック追加
    
    const width = img.offsetWidth || 0;
    if (width > maxWidth && img.offsetParent) {
      maxWidth = width;
      largestValidImage = img;
    }
  });
  
  if (largestValidImage) {
    elementCache.image = largestValidImage;
  }
  
  return largestValidImage;
}

  // サイト固有の初期化 - 他の拡張機能や既存のスクリプトとの競合を避ける
  function initForSite() {
    // streamedup.com 用の特別な初期化
    if (isStreamedUp) {
      console.log('StreamedUp サイト用の初期化を実行中...');
      
      // このサイト専用の名前空間を使用
      if (!window.SimpleOCRExtension) {
        window.SimpleOCRExtension = {
          initialized: false
        };
      }
      
      // 二重初期化の防止
      if (window.SimpleOCRExtension.initialized) {
        console.log('既に初期化済みのため、再初期化をスキップします');
        return false; // 初期化済みの場合は false を返す
      }
      
      window.SimpleOCRExtension.initialized = true;
      return true; // 初期化成功
    }
    
    // それ以外のサイトでは常に初期化を続行
    return true;
  }
  
  // サイト固有の初期化を実行
  if (!initForSite()) {
    // 初期化をスキップする場合は早期リターン
    return;
  }
  
  // STREAMED Dock サイト専用の設定
  if (isStreamedUp) {
    // 特定のページ要素との競合を避けるためのCSS調整
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      /* StreamedUp専用のスタイル上書き */
      .ocr-notification {
        /* サイトのz-indexより高くする */
        z-index: 100000 !important;
        /* 他のUIと被らない位置に */
        top: 70px !important;
      }
      
      /* サイトのヘッダーと干渉しないように */
      .ocr-context-menu {
        z-index: 100000 !important;
      }
      
      /* 選択モード時のスタイル */
      body.ocr-selecting {
        overflow: hidden !important;
      }
      
      .ocr-selection-overlay, .ocr-selection-box {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 99999 !important;
      }
    `;
    document.head.appendChild(styleElement);
  }
  


async function initializeLocalLLMModel(modelName) {
  try {
    console.log(`ローカルLLMモデル "${modelName}" を初期化中...`);
    
    // ===== 修正: WebLLM対応のローカルLLMエンジンを確実に読み込み =====
    if (!window.localLLMEngine) {
      console.log('ローカルLLMエンジンを読み込み中...');
      
      // local-llm-engine.js が読み込まれていない場合は読み込む
      if (!window.LocalLLMEngine) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = chrome.runtime.getURL('lib/local-llm-engine.js');
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
        
        // スクリプトが読み込まれるまで少し待機
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // LocalLLMEngine クラスが利用可能になったらインスタンスを作成
      if (window.LocalLLMEngine) {
        window.localLLMEngine = new window.LocalLLMEngine();
        console.log('ローカルLLMエンジンインスタンスを作成しました');
      } else {
        throw new Error('LocalLLMEngine クラスの読み込みに失敗しました');
      }
    }
    
    // ===== 修正: 初期化プロセスを確実に実行 =====
    if (!window.localLLMEngine.initialized || window.localLLMEngine.modelName !== modelName) {
      console.log('ローカルLLMを初期化しています...');
      
      const success = await window.localLLMEngine.initialize(modelName);
      
      if (success) {
        console.log('ローカルLLMモデル初期化完了');
        
        // ===== 追加: 初期化成功をブラウザストレージに保存 =====
        try {
          await chrome.storage.local.set({
            'localLLMInitialized': true,
            'localLLMModel': modelName,
            'localLLMLastInitialized': Date.now()
          });
          console.log('初期化状態をストレージに保存しました');
        } catch (storageError) {
          console.warn('ストレージ保存エラー:', storageError);
          // ストレージエラーは致命的ではないので続行
        }
        
        return { success: true, model: modelName };
      } else {
        throw new Error('モデル初期化に失敗しました');
      }
    } else {
      console.log('ローカルLLMは既に初期化済みです');
      return { success: true, model: modelName };
    }
    
  } catch (error) {
    console.error('ローカルLLMモデル初期化エラー:', error);
    
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
  }
}

/**
 * ローカルLLMステータスを取得
 */
function getLocalLLMStatus() {
  try {
    if (!window.localLLMEngine) {
      return {
        initialized: false,
        loading: false,
        modelName: null,
        webllmLoaded: false,
        error: 'ローカルLLMエンジンが読み込まれていません'
      };
    }
    
    const status = window.localLLMEngine.getStatus();
    
    // ===== 修正: より詳細なステータス情報を返す =====
    return {
      initialized: status.initialized || false,
      loading: status.loading || false,
      modelName: status.modelName || null,
      webllmLoaded: status.webllmLoaded || false,
      isLoading: status.isLoading || false,
      availableModels: window.localLLMEngine.getAvailableModels ? window.localLLMEngine.getAvailableModels() : []
    };
    
  } catch (error) {
    console.error('ローカルLLMステータス取得エラー:', error);
    return {
      initialized: false,
      loading: false,
      modelName: null,
      webllmLoaded: false,
      error: error.message
    };
  }
}

/**
 * ローカルLLMでテキスト抽出
 */
async function extractTextWithLocalLLM(imageData, options = {}) {
  if (!window.localLLMEngine || !window.localLLMEngine.initialized) {
    throw new Error('ローカルLLMが初期化されていません');
  }
  
  try {
    const result = await window.localLLMEngine.extractText(imageData, options);
    
    // 結果の検証
    if (!result.text || result.text.trim().length === 0) {
      throw new Error('ローカルLLMから有効なテキストが取得できませんでした');
    }
    
    return result;
    
  } catch (error) {
    console.error('ローカルLLMテキスト抽出エラー:', error);
    throw error;
  }
}

/**
 * ローカルLLM使用統計を取得
 */
async function getLocalLLMUsageStats() {
  try {
    // セッションストレージから統計を取得
    const result = await new Promise((resolve) => {
      chrome.storage.session.get(['localLLMUsageStats'], resolve);
    });
    
    const stats = result.localLLMUsageStats || [];
    
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
    
    return summary;
    
  } catch (error) {
    console.error('ローカルLLM統計取得エラー:', error);
    throw error;
  }
}

/**
 * ローカルLLM使用統計を保存
 */
function saveLocalLLMUsageStats(method, processingTime) {
  try {
    const stats = {
      timestamp: Date.now(),
      method: method,
      processingTime: processingTime
    };

    chrome.storage.session.get(['localLLMUsageStats'], (result) => {
      const currentStats = result.localLLMUsageStats || [];
      currentStats.push(stats);
      
      // 最新100件のみ保持
      if (currentStats.length > 100) {
        currentStats.splice(0, currentStats.length - 100);
      }
      
      chrome.storage.session.set({ 'localLLMUsageStats': currentStats });
    });
    
  } catch (error) {
    console.warn('ローカルLLM統計保存エラー:', error);
  }
}



  // ping メッセージに応答するリスナー
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === "ping") {
      sendResponse({status: "ok"});
    } else if (request.action === "startSelection") {
      toggleSelectionMode();
      sendResponse({status: "started"});
    } else if (request.action === "fillTextField") {
      fillTextField(request.text, request.field);
      sendResponse({status: "filled"});
    } else if (request.action === "showProcessing") {
      showNotification(request.message, "processing");
      sendResponse({status: "showing"});
    } else if (request.action === "hideProcessing") {
      // 処理中通知を非表示
      const processingNotifications = document.querySelectorAll('.ocr-notification.processing');
      processingNotifications.forEach(notification => {
        if (document.body.contains(notification)) {
          document.body.removeChild(notification);
        }
      });
      sendResponse({status: "hidden"});
    } else if (request.action === "showError") {
      showErrorWithRetry(request.error, function() {
        // 再試行時の処理（オプション）
      });
      sendResponse({status: "error-shown"});


    }else if (request.action === "showNotification") {
      // 通知メッセージを表示
      showNotification(request.message, request.type || 'info');
      sendResponse({success: true});
    } else if (request.action === "updatePreviewStatus") {
      // プレビューのステータスを更新
      updatePreviewStatus(request.status, request.type || 'info');
      sendResponse({success: true});
    }else if (request.action === "checkFieldValues") {
      const fields = request.fields || [];
      const values = {};
      
      // 各フィールドの値を取得
      fields.forEach(fieldType => {
        let targetInput = null;
        
        // フィールドタイプに応じた入力欄を特定
        switch (fieldType) {
          case 'phone-number':
            targetInput = document.querySelector('[data-input-text="phone-number"]');
            break;
          case 'payee-name':
            targetInput = document.querySelector('[data-input-text="payee-name"]');
            break;
          case 'phonetic':
            targetInput = document.querySelector('[data-input-text="phonetic"]');
            break;
        }
        
        // フィールドの値を保存
        values[fieldType] = targetInput ? targetInput.value : '';
      });
      
      sendResponse(values);
      return true; // 非同期レスポンスのためtrue返す
    }else if (request.action === "checkFieldEmpty") {
      const fieldType = request.field;
      let targetInput = null;
      
      // フィールドタイプに応じた入力欄を特定
      switch (fieldType) {
        case 'phone-number':
          targetInput = document.querySelector('[data-input-text="phone-number"]');
          break;
        case 'payee-name':
          targetInput = document.querySelector('[data-input-text="payee-name"]');
          break;
        case 'phonetic':
          targetInput = document.querySelector('[data-input-text="phonetic"]');
          break;
      }
      
      // フィールドの空状態を確認
      let isEmpty = false;
      if (targetInput) {
        isEmpty = !targetInput.value || targetInput.value.trim() === '';
      }
      
      sendResponse({isEmpty: isEmpty});
    }else if (request.action === "initializeLocalLLMModel") {
    console.log('ローカルLLMモデル初期化リクエスト受信:', request.model);
    
    // 非同期処理を適切に処理
    initializeLocalLLMModel(request.model)
      .then(result => {
        console.log('初期化成功:', result);
        sendResponse(result);
      })
      .catch(error => {
        console.error('初期化失敗:', error);
        sendResponse({ 
          success: false, 
          error: error.message,
          details: error.stack
        });
      });
    return true; // 非同期レスポンス
  }
  
  else if (request.action === "getLocalLLMStatus") {
    const status = getLocalLLMStatus();
    sendResponse({ success: true, status: status });
    return false; // 同期レスポンス
  }
  
  else if (request.action === "extractTextWithLocalLLM") {
    extractTextWithLocalLLM(request.imageData, request.options)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 非同期レスポンス
  }

  
  else if (request.action === "getLocalLLMUsageStats") {
    // ローカルLLM使用統計の取得
    getLocalLLMUsageStats()
      .then(stats => sendResponse({ success: true, stats: stats }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 非同期レスポンス
  }
  
  else if (request.action === "restoreFocus") {
    const field = request.field || 'payee-name'; // デフォルトは支払先名
    
    // フィールドタイプに応じた入力欄を特定
    let targetInput = null;
    
    switch (field) {
      case 'phone-number':
        targetInput = document.querySelector('[data-input-text="phone-number"]');
        break;
      case 'payee-name':
        targetInput = document.querySelector('[data-input-text="payee-name"]');
        break;
      case 'phonetic':
        targetInput = document.querySelector('[data-input-text="phonetic"]');
        break;
    }
    
    // フォーカスを設定
    if (targetInput) {
      // 少し遅延させてフォーカスを設定（他の処理が完了後）
      setTimeout(() => {
        targetInput.focus();
        
        // 入力値があればカーソルを末尾に
        if (targetInput.value) {
          targetInput.setSelectionRange(targetInput.value.length, targetInput.value.length);
        }
        
        // 現在のフォーカスフィールドを更新（必要に応じて）
        if (typeof window.currentFocusField !== 'undefined') {
          window.currentFocusField = targetInput;
        }
        
        console.log(`フォーカスを${field}フィールドに復元しました`);
      }, 100);
    }
    
    sendResponse({success: true});
    return true;
  }
  return true; // 非同期レスポンスのため
  });
  
  // 選択モードの切り替え
  function toggleSelectionMode() {
    selectionModeActive = !selectionModeActive;
    
    if (selectionModeActive) {
      startSelectionMode();
    } else {
      endSelectionMode();
    }
  }
  
  // 選択モードの開始
  function startSelectionMode() {
    // カーソルを十字に変更
    document.body.style.cursor = 'crosshair';
    
    // 既存のselectionBoxを削除
    if (selectionBox) {
      document.body.removeChild(selectionBox);
    }
    
    // 画像のドラッグを防止するスタイルを追加
    const style = document.createElement('style');
    style.id = 'ocr-selection-style';
    style.textContent = `
      img {
        -webkit-user-drag: none !important;
        -khtml-user-drag: none !important;
        -moz-user-drag: none !important;
        -o-user-drag: none !important;
        user-drag: none !important;
        pointer-events: auto !important;
      }
      
      body {
        overflow: hidden !important;
      }
    `;
    document.head.appendChild(style);
    document.addEventListener('mousedown', handleMouseDown);
    
    // スクロールを防止
    document.body.classList.add('ocr-selecting');
    
    // 通知を表示
    showNotification('選択モードがオンになりました。Alt+Shift+Oキーで解除できます。', 'info');
  }
  
  // 選択モードの終了
  function endSelectionMode() {
    // カーソルを元に戻す
    document.body.style.cursor = 'default';
    
    // 既存のselectionBoxを削除
    if (selectionBox) {
      document.body.removeChild(selectionBox);
      selectionBox = null;
    }
    
    // 追加したスタイルを削除
    const style = document.getElementById('ocr-selection-style');
    if (style) {
      document.head.removeChild(style);
    }
    document.removeEventListener('mousedown', handleMouseDown);
    
    // スクロール防止を解除
    document.body.classList.remove('ocr-selecting');
    
    // 通知を表示
    showNotification('選択モードがオフになりました', 'info');
  }
  
  // マウスダウンのハンドラー
// content.js の領域選択部分を改善
function handleMouseDown(e) {
  // 対象が画像かどうかをチェック
  if (e.target.tagName !== 'IMG') {
    // 画像でない場合は処理を中止
    showNotification('画像上で選択してください', 'warning');
    return;
  }
  
  // 画像の実際の位置とサイズを取得
  const targetImage = e.target;
  const rect = targetImage.getBoundingClientRect();
  
  // 画像の元のサイズとスケーリング係数を保存
  const originalWidth = targetImage.naturalWidth;
  const originalHeight = targetImage.naturalHeight;
  const scaleX = originalWidth / rect.width;
  const scaleY = originalHeight / rect.height;
  
  // グローバル変数に情報を保存
  window.ocrTargetImage = {
    element: targetImage,
    rect: rect,
    scaleX: scaleX,
    scaleY: scaleY
  };
  
  // 選択開始
  isSelecting = true;
  startX = e.clientX;
  startY = e.clientY;
  
  // 選択ボックスの作成
  selectionBox = document.createElement('div');
  selectionBox.style.position = 'absolute';
  selectionBox.style.border = '2px dashed red';
  selectionBox.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
  selectionBox.style.zIndex = '100000';
  document.body.appendChild(selectionBox);
  
  // イベントリスナー追加
  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
}

  // マウス移動のハンドラー
  function handleMouseMove(e) {
    if (!isSelecting) return;
    
    // デフォルトのドラッグ動作を防止
    e.preventDefault();
    e.stopPropagation();

    const width = e.clientX - startX;
    const height = e.clientY - startY;
    
    selectionBox.style.left = (width > 0 ? startX : e.clientX) + 'px';
    selectionBox.style.top = (height > 0 ? startY : e.clientY) + 'px';
    selectionBox.style.width = Math.abs(width) + 'px';
    selectionBox.style.height = Math.abs(height) + 'px';
  }

  function showAreaPreview(imageData) {
    // 既存のプレビューを削除
    const existingPreview = document.getElementById('ocr-area-preview-container');
    if (existingPreview) {
      document.body.removeChild(existingPreview);
    }
    
    // プレビューコンテナを作成
    const previewContainer = document.createElement('div');
    previewContainer.id = 'ocr-area-preview-container';
    previewContainer.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      width: 200px;
      height: auto;
      background-color: white;
      border: 2px solid #1a73e8;
      border-radius: 6px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      z-index: 100000;
      overflow: hidden;
    `;
    
    // ヘッダーを作成
    const previewHeader = document.createElement('div');
    previewHeader.style.cssText = `
      width: 100%;
      padding: 5px;
      background-color: #1a73e8;
      color: white;
      font-size: 12px;
      font-family: Arial, sans-serif;
      display: flex;
      justify-content: space-between;
      align-items: center;
    `;
    previewHeader.textContent = 'OCR選択領域';
    
    // 閉じるボタン
    const closeButton = document.createElement('span');
    closeButton.textContent = '✕';
    closeButton.style.cssText = `
      cursor: pointer;
      padding: 0 5px;
    `;
    closeButton.onclick = function() {
      document.body.removeChild(previewContainer);
    };
    
    // 画像プレビュー
    const previewImage = document.createElement('img');
    previewImage.src = imageData;
    previewImage.style.cssText = `
      width: 100%;
      height: auto;
      display: block;
    `;
    
    // ステータスバー
    const statusBar = document.createElement('div');
    statusBar.className = 'ocr-preview-status';
    statusBar.textContent = 'OCR処理中...';
    statusBar.style.cssText = `
      padding: 5px;
      font-size: 11px;
      background-color: #f5f5f5;
      color: #333;
    `;
    
    // 要素を組み立て
    previewHeader.appendChild(closeButton);
    previewContainer.appendChild(previewHeader);
    previewContainer.appendChild(previewImage);
    previewContainer.appendChild(statusBar);
    
    document.body.appendChild(previewContainer);
    
    return { container: previewContainer, image: previewImage, statusBar: statusBar };
  }

// ドラッグ可能な要素を作成する関数（シンプル化）
function makeDraggable(element, handle = null) {
  const dragHandle = handle || element;
  let isDragging = false;
  let offsetX, offsetY;
  
  dragHandle.style.cursor = 'move';
  
  dragHandle.addEventListener('mousedown', function(e) {
    isDragging = true;
    offsetX = e.clientX - element.getBoundingClientRect().left;
    offsetY = e.clientY - element.getBoundingClientRect().top;
    e.preventDefault();
  });
  
  document.addEventListener('mousemove', function(e) {
    if (!isDragging) return;
    
    // 新しい位置を計算
    let newX = e.clientX - offsetX;
    let newY = e.clientY - offsetY;
    
    // 画面外に出ないように制限
    newX = Math.max(0, Math.min(newX, window.innerWidth - element.offsetWidth));
    newY = Math.max(0, Math.min(newY, window.innerHeight - element.offsetHeight));
    
    // 位置を設定
    element.style.left = newX + 'px';
    element.style.top = newY + 'px';
  });
  
  document.addEventListener('mouseup', function() {
    isDragging = false;
  });
}

function captureSelectedArea(targetImage) {
  if (!targetImage && window.ocrTargetImage) {
    targetImage = window.ocrTargetImage.element;
  }
  
  if (!targetImage || targetImage.tagName !== 'IMG') {
    showNotification('有効な画像が選択されていません', 'error');
    return;
  }
  
  const rect = selectionBox.getBoundingClientRect();
  const imageRect = targetImage.getBoundingClientRect();
  
  // 画像の座標系に変換 - シンプル化
  const relativeX = Math.max(0, rect.left - imageRect.left);
  const relativeY = Math.max(0, rect.top - imageRect.top);
  const relativeWidth = Math.min(rect.width, imageRect.right - rect.left);
  const relativeHeight = Math.min(rect.height, imageRect.bottom - rect.top);
  
  // Canvas を使用して画像の一部を切り取る
  const canvas = document.createElement('canvas');
  canvas.width = relativeWidth;
  canvas.height = relativeHeight;
  const ctx = canvas.getContext('2d');
  
  try {
    // シンプルな描画
    ctx.drawImage(
      targetImage,
      relativeX, relativeY, relativeWidth, relativeHeight,
      0, 0, canvas.width, canvas.height
    );
    
    // 画像データを取得（品質を少し下げて処理速度向上）
    const imageData = canvas.toDataURL('image/jpeg', 0.85);
    
    // 処理中の通知
    showNotification('テキスト認識中...', 'processing');
    
    // プレビュー表示（シンプル化）
    showAreaPreview(imageData);
    
    // バックグラウンドスクリプトに送信
    chrome.runtime.sendMessage({
      action: "processImage",
      imageData: imageData
    });
  } catch (error) {
    showNotification('画像の処理中にエラーが発生しました: ' + error.message, 'error');
  }
}
  

// フィールドにテキストを入力する関数
function fillTextField(text, fieldType) {
  if (!text) return false;
  
  let targetInput = null;
  
  // フィールドタイプに応じた入力欄を特定
  switch (fieldType) {
    case 'phone-number':
      targetInput = document.querySelector('[data-input-text="phone-number"]');
      break;
    case 'payee-name':
      targetInput = document.querySelector('[data-input-text="payee-name"]');
      break;
    case 'phonetic':
      targetInput = document.querySelector('[data-input-text="phonetic"]');
      break;
    case 'clipboard':
      // クリップボードモードの場合
      navigator.clipboard.writeText(text)
        .then(() => showNotification('テキストをクリップボードにコピーしました', 'success'))
        .catch(() => showNotification('クリップボードへのコピーに失敗しました', 'error'));
      return true;
  }
  
  if (targetInput) {
    try {
      // フォーカスを設定
      targetInput.focus();
      
      // テキストを入力
      targetInput.value = text.trim();
      
      // イベント発火
      targetInput.dispatchEvent(new Event('input', { bubbles: true }));
      targetInput.dispatchEvent(new Event('change', { bubbles: true }));
      
      // 認識成功通知
      showNotification(`「${text.trim()}」を認識しました`, 'success');
      
      // Enterキーを押したようにシミュレート
      setTimeout(() => {
        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          bubbles: true
        });
        targetInput.dispatchEvent(enterEvent);
      }, 100);
      
      return true;
    } catch (err) {
      console.error('フィールド入力エラー:', err);
      showNotification('入力フィールドの更新に失敗しました', 'error');
      return false;
    }
  } else {
    showNotification('対象のフィールドが見つかりません', 'error');
    return false;
  }
}
  
  // 通知を表示する関数
function showNotification(message, type = 'info', duration = 3000) {
  // 既存の同タイプの通知を削除
  const existingNotification = document.querySelector(`.ocr-notification.${type}`);
  if (existingNotification) {
    document.body.removeChild(existingNotification);
  }
  
  // 通知要素の作成
  const notification = document.createElement('div');
  notification.textContent = message;
  notification.className = `ocr-notification ${type}`;
  
  // スタイル設定
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 20px;
    border-radius: 5px;
    z-index: 100000;
    font-family: Arial, sans-serif;
    font-size: 14px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    background-color: ${
      type === 'error' ? 'rgba(220, 53, 69, 0.9)' :
      type === 'success' ? 'rgba(40, 167, 69, 0.9)' :
      type === 'processing' ? 'rgba(0, 123, 255, 0.9)' :
      'rgba(0, 0, 0, 0.7)'
    };
    color: ${type === 'warning' ? 'black' : 'white'};
  `;
  
  document.body.appendChild(notification);
  
  // 自動非表示（エラーと処理中は除く）
  if (duration && type !== 'error') {
    setTimeout(() => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    }, duration);
  }
  
  return notification;
}
  
/**
 * 再試行ボタン付きエラー通知 - 認識結果なしの場合も対応
 * @param {string} message - エラーメッセージ
 * @param {Function} callback - 再試行時のコールバック
 * @param {boolean} isNoResult - 認識結果なしエラーの場合true
 */
function showErrorWithRetry(message, callback, isNoResult = false) {
  // 既存の通知を削除
  const existingNotifications = document.querySelectorAll('.ocr-notification');
  existingNotifications.forEach(notif => {
    if (document.body.contains(notif)) {
      document.body.removeChild(notif);
    }
  });
  
  // 通知要素を作成
  const errorNotification = document.createElement('div');
  errorNotification.className = 'ocr-notification ocr-notification-error';
  
  // 通常のエラーと認識結果なしエラーでスタイルを少し変える
  errorNotification.style.backgroundColor = isNoResult ? 'rgba(255, 152, 0, 0.9)' : 'rgba(220, 53, 69, 0.9)';
  
  errorNotification.style.position = 'fixed';
  errorNotification.style.top = '20px';
  errorNotification.style.left = '50%';
  errorNotification.style.transform = 'translateX(-50%)';
  errorNotification.style.padding = '10px 20px';
  errorNotification.style.borderRadius = '5px';
  errorNotification.style.zIndex = '10000';
  errorNotification.style.fontFamily = 'Arial, sans-serif';
  errorNotification.style.fontSize = '14px';
  errorNotification.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
  errorNotification.style.color = 'white';
  errorNotification.style.display = 'flex';
  errorNotification.style.flexDirection = 'column';
  errorNotification.style.alignItems = 'center';
  
  // エラーメッセージ
  const messageDiv = document.createElement('div');
  messageDiv.textContent = message;
  messageDiv.style.marginBottom = '10px';
  errorNotification.appendChild(messageDiv);
  
  // 再試行ボタン
  const retryButton = document.createElement('button');
  retryButton.textContent = isNoResult ? '別の領域を選択' : '再試行';
  retryButton.style.padding = '5px 15px';
  retryButton.style.backgroundColor = 'white';
  retryButton.style.color = isNoResult ? 'rgba(255, 152, 0, 1)' : 'rgba(220, 53, 69, 1)';
  retryButton.style.border = 'none';
  retryButton.style.borderRadius = '3px';
  retryButton.style.cursor = 'pointer';
  retryButton.style.fontWeight = 'bold';
  retryButton.addEventListener('click', function() {
    if (document.body.contains(errorNotification)) {
      document.body.removeChild(errorNotification);
    }
    if (typeof callback === 'function') {
      callback();
    }
  });
  errorNotification.appendChild(retryButton);
  
  document.body.appendChild(errorNotification);
  
  // 15秒後に通知を消す
  setTimeout(() => {
    if (document.body.contains(errorNotification)) {
      document.body.removeChild(errorNotification);
    }
  }, 8000);
  
  return errorNotification;
}

  
  /**
 * OCR処理結果でプレビューのステータスを更新する関数
 * @param {string} status - 表示するステータステキスト
 * @param {string} type - ステータスタイプ（success/error/info）
 */
function updatePreviewStatus(status, type = 'info') {
  // プレビューコンテナを探す
  const preview = document.getElementById('ocr-area-preview-container');
  if (!preview) return; // プレビューがなければ何もしない
  
  // ステータスバーを探す
  let statusBar = preview.querySelector('.ocr-preview-status');
  
  // ステータスバーが存在しない場合は作成
  if (!statusBar) {
    statusBar = document.createElement('div');
    statusBar.className = 'ocr-preview-status';
    preview.appendChild(statusBar);
  }
  
  // テキスト内容を更新
  statusBar.textContent = status;
  
  // すべてのクラスをリセットしてからタイプに合わせたクラスを追加
  statusBar.className = 'ocr-preview-status';
  if (type === 'success') {
    statusBar.classList.add('success');
  } else if (type === 'error') {
    statusBar.classList.add('error');
  }
}


function isValidImage(img) {
  if (!img || img.tagName !== 'IMG') {
    return false;
  }
  
  if (!img.complete) {
    return false;
  }
  
  const naturalWidth = img.naturalWidth || 0;
  const naturalHeight = img.naturalHeight || 0;
  
  if (naturalWidth === 0 || naturalHeight === 0) {
    console.log('画像の自然サイズが無効:', naturalWidth, 'x', naturalHeight);
    return false;
  }
  
  if (naturalWidth < 10 || naturalHeight < 10) {
    console.log('画像が小さすぎます:', naturalWidth, 'x', naturalHeight);
    return false;
  }
  
  const src = img.src || '';
  if (src.startsWith('http') && img.naturalWidth === 0) {
    console.log('HTTP画像の読み込みが失敗している可能性');
    return false;
  }
  
  return true;
}



// 全体画像OCR処理関数を追加
function processFullImageForOCR(imgElement) {
  // 画像の有効性チェックを追加
  if (!imgElement || !isValidImage(imgElement)) {
    showNotification('有効な画像が見つかりません。画像が読み込まれているか確認してください。', 'error');
    window.globalOcrLock.release();
    return;
  }
    try {
    // Canvas を作成
    const canvas = document.createElement('canvas');
    canvas.width = imgElement.naturalWidth || imgElement.width;
    canvas.height = imgElement.naturalHeight || imgElement.height;
    
    // 2Dコンテキストを取得
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2Dコンテキストを取得できませんでした');
    }
    
    // 画像を描画
    ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);
    
    // 画像データを取得
    const imageData = canvas.toDataURL('image/jpeg', 0.95);
    
    // バックグラウンドスクリプトに送信
    chrome.runtime.sendMessage({
      action: "processImage",
      imageData: imageData,
      field: 'payee-name' // デフォルトフィールド
    }, response => {
      if (chrome.runtime.lastError) {
        console.error('メッセージ送信エラー:', chrome.runtime.lastError);
        showNotification('OCR処理のリクエストに失敗しました', 'error');
        window.globalOcrLock.release();
      }
    });
    
  } catch (error) {
    console.error('画像処理エラー:', error);
    showNotification('画像の処理に失敗しました: ' + error.message, 'error');
    window.globalOcrLock.release();
  }
}



// Alt+Shift+Z のショートカットキーを監視
document.addEventListener('keydown', function(e) {
     e.preventDefault();
    e.stopPropagation();
    
    console.log('Alt+Shift+Z ショートカットが押されました');
     // Alt+Shift+Z (Alt: 18, Shift: 16, Z: 90)
  if (e.altKey && e.shiftKey && e.keyCode === 90) {
        // ===== 追加: ロックチェック =====
  // 設定を確認してからOCR処理を実行
    chrome.storage.local.get(['geminiApiKey'], function(result) {
      if (!result.geminiApiKey) {
        showNotification('Gemini APIキーが設定されていません', 'error');
        window.globalOcrLock.release();
        return;
      }
      
      // 画像要素を探す
      const img = findImageElement();
      if (!img) {
        showNotification('画像が見つかりません', 'error');
        window.globalOcrLock.release();
        return;
      }
      
      // 処理中通知
      showNotification('OCR処理中...', 'processing');
      
      try {
        // 画像を処理してOCR実行
        processFullImageForOCR(img);
      } catch (error) {
        console.error('OCR処理エラー:', error);
        showNotification('OCR処理に失敗しました: ' + error.message, 'error');
        window.globalOcrLock.release();
      }
    });
  }
});
});
