/**
 * STREAMED Dock サイト専用の OCR 連携スクリプト (Gemini API版)
 * 画面内に統合されたシンプルなUI + オートモード対応
 */

(function() {
    // 重複初期化を防ぐためのグローバルチェック
  if (window.StreamedDockOcrInitialized) {
    console.log('STREAMED Dock OCR連携は既に初期化済みです');
    return;
  }
  window.StreamedDockOcrInitialized = true;
  // ==============================================================
  // 
  // // 初期化状態
  const STATE = {
    initialized: false,
    isSelecting: false,
    startX: 0,
    startY: 0,
    selectionBox: null,
    isProcessing: false,
    ocrProcessingComplete: false,
    isAutoMode: false, // オートモードフラグ
    hasTriggeredAutoOcr: false // 自動OCR実行済みフラグ
  };




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




if (!window.ocrResourceManager) {
  window.ocrResourceManager = {
    observers: [],
    intervals: [],
    timeouts: [],
    
    // リソースを登録
    register: function(type, resource) {
      if (type === 'observer' && resource) {
        this.observers.push(resource);
      } else if (type === 'interval' && resource) {
        this.intervals.push(resource);
      } else if (type === 'timeout' && resource) {
        this.timeouts.push(resource);
      }
    },
    
    // すべてのリソースをクリーンアップ
    cleanup: function() {
      // MutationObserverをすべて停止
      this.observers.forEach(observer => {
        try {
          observer.disconnect();
        } catch (e) {
          console.warn('Observer cleanup error:', e);
        }
      });
      this.observers = [];
      
      // setIntervalをすべてクリア
      this.intervals.forEach(intervalId => {
        try {
          clearInterval(intervalId);
        } catch (e) {
          console.warn('Interval cleanup error:', e);
        }
      });
      this.intervals = [];
      
      // setTimeoutをすべてクリア
      this.timeouts.forEach(timeoutId => {
        try {
          clearTimeout(timeoutId);
        } catch (e) {
          console.warn('Timeout cleanup error:', e);
        }
      });
      this.timeouts = [];
      
      console.log('OCRリソースをクリーンアップしました');
    }
  };
  
  // ページ離脱時の自動クリーンアップ
  window.addEventListener('beforeunload', () => {
  // 確実にすべてのObserverを停止
  if (globalObserver) {
    globalObserver.disconnect();
    globalObserver = null;
  }
  // その他のリソースも確実にクリーンアップ
  window.ocrResourceManager?.cleanup();
  });
}





  // 初期化処理内で設定を読み込み
  function initialize() {
      if (STATE.initialized) return;
    // ===== 追加: 初期化時の状態復旧 =====
    console.log('前回の状態をクリーンアップしています...');
    
    // ロック状態を強制解除
    if (window.globalOcrLock && window.globalOcrLock.isLocked) {
      window.globalOcrLock.release();
    }
    
    // UI状態を強制リセット
    resetUIState();
    
    // 残存する通知を削除
    cleanupNotifications();
    // ===============================

    console.log('STREAMED Dock OCR連携を初期化しています...');
    
    // 設定を読み込み
    loadAutoModeSettingsAsync();
    
    // 必要なスタイルを追加
    addGlobalStyles();
    
    // UI要素の追加
    addStreamedDockUi();
    
    // イベントリスナーの設定
    setupEventListeners();
    
    // 保存監視を追加
    setupSaveMonitoring();
    
    
    
    disableDuplicateClickHandlers();

    // 少し遅延させて統一されたクリック処理をセットアップ（画像読み込み完了後）
   // setTimeout(() => {
   //   setupUnifiedClickHandlers();
   // }, 500);

    // OCRボタンの状態を更新
    updateOcrButtonStates();
    
    // OCRボタンの不透明度を調整
    updateOCRButtonsOpacity();

    setupRotationWatcher();
    
    // グローバルアクセスのために window オブジェクトに公開
    window.StreamedDockOcr = {
      startSelection: startAreaSelection,
      processRegion: processImageRegion,
      processFull: processFullImage
    };
    
    // 初期化完了
    STATE.initialized = true;
    console.log('STREAMED Dock OCR連携の初期化が完了しました');
    
    // 初期化完了通知
    showNotification('OCR機能が利用可能になりました', 'success');
    
    // APIキーをチェック
    checkApiKey();
    
    // オートモード監視を即座に開始（設定読み込み後に）
  const timeoutId = setTimeout(() => {
    if (STATE.isAutoMode) {
      console.log('オートモード有効 - 即座に監視を開始します');
      setupAutoModeWatcher();
      // 即座に初回チェックも実行
      setTimeout(() => checkForAutoOcr(), 50);
    } else {
      console.log('オートモード無効 - 監視はスキップします');
    }
  }, 50); // 200ms → 50msに大幅短縮

  }


function resetUIState() {
  // 選択モードを強制終了
  document.body.classList.remove('ocr-selecting');
  document.body.style.overflow = '';
  document.body.style.cursor = 'default';
  
  // 選択ボックスやオーバーレイを削除
  const overlays = document.querySelectorAll('.ocr-selection-overlay, .ocr-selection-box');
  overlays.forEach(el => el.remove());
  
  // ボタン状態をリセット
  const buttons = document.querySelectorAll('.ocr-area-btn, .ocr-full-btn');
  buttons.forEach(btn => {
    btn.disabled = false;
    btn.classList.remove('processing');
    btn.style.opacity = '1';
  });
  
  // STATE変数をリセット
  STATE.isSelecting = false;
  STATE.isProcessing = false;
  STATE.ocrProcessingComplete = false;
  STATE.hasTriggeredAutoOcr = false;
}

function cleanupNotifications() {
  const notifications = document.querySelectorAll('.ocr-notification, .ocr-area-preview-container');
  notifications.forEach(notification => notification.remove());
}

// ページ可視性変更時の処理も追加
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') {
    // タブがアクティブになった時の状態チェック
    setTimeout(resetUIState, 100);
  }
});

/**
 * オートモード設定を非同期で読み込む（改善版）
 */
async function loadAutoModeSettingsAsync() {
  console.log('オートモード設定を読み込み中...');
  
  try {
    const result = await new Promise((resolve) => {
      chrome.storage.local.get(['ocrAutoMode'], resolve);
    });
    
    STATE.isAutoMode = result.ocrAutoMode === true;
    console.log('オートモード設定:', STATE.isAutoMode ? 'ON' : 'OFF');
    
    // オートモードが有効な場合、段階的に監視とチェックを開始
    if (STATE.isAutoMode) {
      console.log('オートモード有効 - 段階的監視開始');
      
      // ステップ1: まず監視を開始（即座）
      setupAutoModeWatcher();
      
      // ステップ2: 短時間後に初回チェック（DOM構築待ち）
      setTimeout(() => {
        console.log('オートモード: 第1回候補チェック実行');
        checkForAutoOcr();
      }, 100);
      
      // ステップ3: 少し長めの間隔で再チェック（画像読み込み待ち）
      setTimeout(() => {
        if (STATE.isAutoMode && !STATE.hasTriggeredAutoOcr && !STATE.isProcessing) {
          console.log('オートモード: 第2回候補チェック実行（画像読み込み待ち）');
          checkForAutoOcr();
        }
      }, 400);
      
      // ステップ4: 最終チェック（完全な初期化待ち）
      setTimeout(() => {
        if (STATE.isAutoMode && !STATE.hasTriggeredAutoOcr && !STATE.isProcessing) {
          console.log('オートモード: 最終候補チェック実行');
          checkForAutoOcr();
        }
      }, 750);
    } else {
      console.log('オートモード無効 - 監視はスキップします');
    }
  } catch (error) {
    console.error('オートモード設定読み込みエラー:', error);
    STATE.isAutoMode = false;
  }
}

/**
 * 同期版オートモード設定読み込み（後方互換性のため）
 */
function loadAutoModeSettings() {
  // 非同期版を呼び出す（Promiseは放置）
  loadAutoModeSettingsAsync().catch(console.error);
}








// グローバル変数でObserverを管理
let globalObserver = null;

/**
 * オートモード用の監視を設定（最適化版）
 */
function setupAutoModeWatcher() {
  console.log('オートモード監視を開始します');
  
  // 既存のObserverを停止
  if (globalObserver) {
    globalObserver.disconnect();
    globalObserver = null;
  }
    // 監視開始時にフラグをリセット
  console.log('オートモード監視開始 - OCRフラグをリセット');
  STATE.hasTriggeredAutoOcr = false;
  // ===========================
  // デバウンス制御用（より短い間隔）
  let checkTimeout = null;
  
  // 単一のObserverで全ての監視を統合
  globalObserver = new MutationObserver(function(mutations) {
    let shouldCheckOcr = false;
    let hasImageChanges = false;
    
    mutations.forEach(function(mutation) {
      // 画像関連の変更
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(function(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName === 'IMG' || (node.querySelector && node.querySelector('img'))) {
              hasImageChanges = true;
            }
          }
        });
      }
      
      // 画像のsrc属性変更
      if (mutation.type === 'attributes' && 
          mutation.target.tagName === 'IMG' && 
          mutation.attributeName === 'src') {
        hasImageChanges = true;
      }
      
      // テーブル関連の変更
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        const target = mutation.target;
        if (target.classList.contains('table-registvendor') || 
            target.classList.contains('kvs-label-novendor')) {
          shouldCheckOcr = true;
        }
      }
      
      // テーブル内容の変更
      if (mutation.type === 'childList') {
        const target = mutation.target;
        if (target.classList && (target.classList.contains('table-registvendor') || 
            target.querySelector('.table-registvendor'))) {
          shouldCheckOcr = true;
        }
      }
    });
    
    // 条件に応じてチェックを実行
    if ((hasImageChanges || shouldCheckOcr) && STATE.isAutoMode && !STATE.hasTriggeredAutoOcr && !STATE.isProcessing) {
      console.log('変更検出 - 候補チェックを実行');
      
      // 既存のタイムアウトをクリア
      if (checkTimeout) {
        clearTimeout(checkTimeout);
        checkTimeout = null;
      }
      
      // 画像変更の場合は短い遅延、DOM変更の場合は即座実行
      const delay = hasImageChanges ? 500 : 100; // 画像: 500ms、DOM: 100ms
      
      checkTimeout = setTimeout(() => {
        if (STATE.isAutoMode && !STATE.hasTriggeredAutoOcr && !STATE.isProcessing) {
          console.log('デバウンス後の候補チェックを実行');
          checkForAutoOcr();
        }
      }, delay);
    }
  });
  

  // document.bodyを単一のObserverで監視
  globalObserver.observe(document.body, { 
    childList: true, 
    subtree: true, 
    attributes: true,
    attributeFilter: ['src', 'class', 'style']
  });
  
  // 軽量な定期チェックを維持（フォールバック用）
  const periodicCheck = setInterval(() => {
    if (!STATE.isAutoMode || STATE.hasTriggeredAutoOcr || STATE.isProcessing) {
      return;
    }
    console.log('フォールバック候補チェックを実行');
    checkForAutoOcr();
  }, 750); 
  
  // ページ離脱時のクリーンアップ
  window.addEventListener('beforeunload', () => {
    console.log('ページ離脱 - 監視を停止');
    if (globalObserver) {
      globalObserver.disconnect();
      globalObserver = null;
    }
      // その他のリソースも確実にクリーンアップ
  window.ocrResourceManager?.cleanup();
    if (checkTimeout) {
      clearTimeout(checkTimeout);
      checkTimeout = null;
    }
    clearInterval(periodicCheck);
  });
  
  console.log('最適化されたオートモード監視が完了しました');
}

  /**
   * 画像が追加された時の処理
   */
  function handleImageAdded(imgElement) {
    if (!STATE.isAutoMode || STATE.hasTriggeredAutoOcr) {
      console.log('画像追加検出もオートモード無効またはOCR実行済み');
      return;
    }
    
    console.log('画像追加を検出:', {
      src: imgElement.src ? imgElement.src.substring(0, 50) + '...' : '(no src)',
      complete: imgElement.complete,
      naturalSize: imgElement.naturalWidth + 'x' + imgElement.naturalHeight
    });
    
    // 画像の読み込み完了を待つ
    if (imgElement.complete && imgElement.naturalWidth > 0) {
      // 既に読み込み完了している場合 - 即座に実行
      console.log('画像は既に読み込み完了 - 即座に候補チェックを実行');
      //checkForAutoOcr(); // 即座実行
 
    } else {
      // 読み込み完了を待つ
      console.log('画像の読み込み完了を待機中...');
      imgElement.onload = function() {
        console.log('画像読み込み完了を検出:', {
          src: this.src ? this.src.substring(0, 50) + '...' : '(no src)',
          size: this.naturalWidth + 'x' + this.naturalHeight
        });
        // 読み込み完了後即座に実行
        //checkForAutoOcr();
      
      };
      
      // エラー時の処理
      imgElement.onerror = function() {
        console.log('画像読み込みエラーを検出:', this.src);
      };
    }
  }


  /**
   * 既存の画像をチェック
   */
  function checkExistingImages() {
    if (!STATE.isAutoMode || STATE.hasTriggeredAutoOcr) return;
    
    const images = document.querySelectorAll('img');
    console.log('既存の画像をチェック:', images.length, '個');
    
    let loadedImages = 0;
    let hasValidImage = false;
    
    images.forEach(img => {
      if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
        loadedImages++;
        
        // 画像のサイズチェック（小さすぎる画像は除外）
        if (img.naturalWidth > 100 && img.naturalHeight > 100) {
          hasValidImage = true;
          console.log('有効な画像を発見:', {
            src: img.src ? img.src.substring(0, 50) + '...' : '(no src)',
            size: img.naturalWidth + 'x' + img.naturalHeight
          });
        }
      }
    });
    
    console.log('画像チェック結果:', {
      total: images.length,
      loaded: loadedImages,
      hasValid: hasValidImage
    });
    
    if (hasValidImage) {
      console.log('有効な読み込み完了画像を発見 - 即座に候補チェックを実行');
      // 即座に実行
      //checkForAutoOcr();

    } else {
      console.log('有効な画像が見つかりません - 待機継続');
    }
  }

/**
 * テーブルに候補があるかチェックして自動OCRを実行（強化版）
 */
function checkForAutoOcr() {
  console.log('=== オートOCRチェック開始 ===');
  console.log('現在の状態:', {
    isAutoMode: STATE.isAutoMode,
    hasTriggeredAutoOcr: STATE.hasTriggeredAutoOcr,
    isProcessing: STATE.isProcessing
  });
  
  if (!STATE.isAutoMode || STATE.hasTriggeredAutoOcr || STATE.isProcessing) {
    console.log('オートOCRスキップ: 条件不一致');
    return;
  }
  
  // 画像読み込み完了チェック（強化版）
  const img = findImageElement();
  console.log('画像要素チェック:', {
    found: !!img,
    complete: img ? img.complete : false,
    naturalSize: img ? `${img.naturalWidth}x${img.naturalHeight}` : 'N/A',
    displaySize: img ? `${img.clientWidth}x${img.clientHeight}` : 'N/A'
  });
  
  if (!img || !img.complete || img.naturalWidth === 0) {
    console.log('画像読み込み未完了のため自動OCRをスキップ');
    return;
  }
  
  console.log('自動OCR条件をチェック中...');
  
  const hasCandidates = checkHasCandidates();
  console.log('テーブル候補チェック結果:', hasCandidates);
  
  if (!hasCandidates.hasResults) {
    console.log('候補なし - 再チェック後にOCR実行を判定します');
    
    // 再チェック機能（改善版）
    setTimeout(() => {
      // 再チェック時の条件確認
      if (!STATE.isAutoMode || STATE.hasTriggeredAutoOcr || STATE.isProcessing) {
        console.log('再チェック時: 条件が変更されたためスキップ');
        return;
      }
      
      console.log('=== 再チェック実行 ===');
      const recheckResult = checkHasCandidates();
      console.log('再チェック結果:', recheckResult);
      
      if (!recheckResult.hasResults) {
        // フラグ設定を再チェック後に移動
        STATE.hasTriggeredAutoOcr = true;
        console.log('再チェック後も候補なし - 自動OCRを実行します');
        
        // APIキーをチェック
        chrome.storage.local.get(['geminiApiKey'], function(result) {
          if (!result.geminiApiKey) {
            console.log('APIキーが設定されていないため自動OCRをスキップ');
            showNotification('自動OCR: APIキーが設定されていません', 'warning');
            STATE.hasTriggeredAutoOcr = false; // フラグをリセット
            return;
          }
          
          // 最終的な重複チェック
          if (STATE.isProcessing) {
            console.log('処理中のため自動OCRをスキップ');
            STATE.hasTriggeredAutoOcr = false; // フラグをリセット
            return;
          }
          
          // 自動OCR実行通知
          showNotification('候補が見つからないため自動OCRを実行中...', 'info', 3000);
          
          console.log('=== 自動OCR実行開始 ===');
          // 全体OCRを実行
          processFullImage();
        });
      } else {
        console.log('再チェックで候補が見つかったため自動OCRをスキップ:', recheckResult.reason);
      }
    }, 400); // 0.4秒後に再実行
    
  } else {
    console.log('候補が見つかったため自動OCRをスキップ:', hasCandidates.reason);
  }
  
  console.log('=== オートOCRチェック終了 ===');
}

/**
 * より詳細な候補存在チェック（電話番号フィールドチェック追加）
 */
function checkHasCandidates() {
  // 1. テーブル要素の存在チェック
  const table = document.querySelector('.table-registvendor');
  
  // 2. テーブルが表示されているかチェック
  const isTableVisible = table && !table.classList.contains('hidden') && 
                         table.style.display !== 'none' &&
                         table.offsetParent !== null;
  
  // ===== No Vendorチェックを最優先に =====
  // 3. "No Vendor" ラベルの状態チェック（最優先）
  const noVendorLabel = document.querySelector('.kvs-label-novendor');
  const isNoVendorVisible = noVendorLabel && 
                           noVendorLabel.offsetParent !== null &&
                           !noVendorLabel.classList.contains('hidden');
  
  // No Vendorが表示されている場合は即座に候補なしと判定
  if (isNoVendorVisible) {
    console.log('No Vendorラベルが表示されているため候補なし');
    return {
      hasResults: false,
      reason: 'No Vendorラベルが表示されています'
    };
  }
  // ===========================
  // 4. 電話番号フィールドが空かどうかをチェック
  const phoneField = document.querySelector('[data-input-text="phone-number"]');
  const isPhoneFieldEmpty = !phoneField || !phoneField.value || phoneField.value.trim() === '';
  
  // 電話番号フィールドが空の場合は候補なしと判定
  if (isPhoneFieldEmpty) {
    console.log('電話番号フィールドが空のため候補なし');
    return {
      hasResults: false,
      reason: '電話番号フィールドが空です'
    };
  }
  // =======================================
  
  // 5. ラジオボタンの存在チェック
  const radioButtons = document.querySelectorAll('.table-registvendor input[type="radio"][name="select_vendor_id"]');
  const radioButtonsWithValue = Array.from(radioButtons).filter(radio => radio.value && radio.value.trim() !== '');
  
  // 6. テーブル内の行数チェック
  const tableRows = document.querySelectorAll('.table-registvendor tbody tr');
  const visibleRows = Array.from(tableRows).filter(row => 
    row.style.display !== 'none' && 
    !row.classList.contains('hidden') &&
    row.offsetParent !== null
  );
  
  // 7. 行に実際のデータが含まれているかチェック
  const rowsWithData = visibleRows.filter(row => {
    const cells = row.querySelectorAll('td');
    return Array.from(cells).some(cell => cell.textContent && cell.textContent.trim() !== '' && cell.textContent.trim() !== '-');
  });
  
  // 8. 検索結果メッセージのチェック
  const searchResultMessage = document.querySelector('#search_result_message');
  const hasSearchMessage = searchResultMessage && 
                          searchResultMessage.textContent && 
                          searchResultMessage.textContent.trim() !== '';
  
  // デバッグ情報をログ出力
  console.log('候補チェック詳細:', {
    table: !!table,
    isTableVisible: isTableVisible,
    isNoVendorVisible: isNoVendorVisible,
    isPhoneFieldEmpty: isPhoneFieldEmpty, 
    phoneFieldValue: phoneField ? phoneField.value : 'フィールドなし', 
    radioButtons: radioButtons.length,
    radioButtonsWithValue: radioButtonsWithValue.length,
    tableRows: tableRows.length,
    visibleRows: visibleRows.length,
    rowsWithData: rowsWithData.length,
    hasSearchMessage: hasSearchMessage,
    searchMessage: searchResultMessage ? searchResultMessage.textContent : 'なし'
  });
  
  // 候補があると判定する条件
  if (isTableVisible && visibleRows.length > 0 && radioButtonsWithValue.length > 0 && rowsWithData.length > 0) {
    return {
      hasResults: true,
      reason: `表示されているテーブルに${rowsWithData.length}件の有効な候補があります`
    };
  }
  
  if (hasSearchMessage && !isNoVendorVisible) {
    return {
      hasResults: true,
      reason: '検索結果メッセージが表示されています'
    };
  }
  
  // 候補がないと判定
  let reason = '候補が見つかりません';
  if (!table) {
    reason = 'テーブル要素が存在しません';
  } else if (!isTableVisible) {
    reason = 'テーブルが非表示です';
  } else if (isNoVendorVisible) {
    reason = 'No Vendorラベルが表示されています';
  } else if (isPhoneFieldEmpty) {
    reason = '電話番号フィールドが空です'; 
  } else if (visibleRows.length === 0) {
    reason = '表示されている行がありません';
  } else if (radioButtonsWithValue.length === 0) {
    reason = '有効なラジオボタンがありません';
  }
  
  return {
    hasResults: false,
    reason: reason
  };
}

  /**
   * オートモード設定の変更を監視
   */
  function watchAutoModeChanges() {
    chrome.storage.onChanged.addListener(function(changes, namespace) {
      if (namespace === 'local' && changes.ocrAutoMode) {
        const newValue = changes.ocrAutoMode.newValue;
        const oldValue = changes.ocrAutoMode.oldValue;
        
        console.log('オートモード設定変更:', oldValue, '->', newValue);
        
        STATE.isAutoMode = newValue === true;
        
        if (STATE.isAutoMode && !oldValue) {
          // オートモードがONになった場合
          STATE.hasTriggeredAutoOcr = false; // フラグをリセット
          setupAutoModeWatcher();
          showNotification('オートモードが有効になりました', 'info');
          
          console.log('オートモード復旧 - 即座に候補チェックを実行');
          setTimeout(() => checkForAutoOcr(), 500);
        } else if (!STATE.isAutoMode && oldValue) {
          // オートモードがOFFになった場合
          showNotification('オートモードが無効になりました', 'info');
        }
      }
    });
  }

  /**
   * 処理中フラグを設定/解除する関数
   * @param {boolean} flag - 処理中かどうかのフラグ
   */
  function setProcessingFlag(flag) {
   STATE.isProcessing = flag; // UI表示のためだけに使用
  console.log(`UI処理フラグを${flag ? 'ON' : 'OFF'}に設定`);
  
  // UI関連の処理のみ
  if (flag) {
    const viewerElement = findViewerElement();
    if (viewerElement) {
      viewerElement.style.cursor = 'progress';
    }
  } else {
    const viewerElement = findViewerElement();
    if (viewerElement) {
      viewerElement.style.cursor = '';
    }
    if (STATE.isSelecting && STATE.ocrProcessingComplete) {
      console.log('OCR処理完了により領域選択モードを自動解除します');
      endAreaSelection();
      STATE.ocrProcessingComplete = false;
    }
  }
}

  /**
   * ALT+クリック操作を統一して処理する関数（修正版）
   * - ALT + シングルクリック: 全体OCR実行
   * - ALT + ダブルクリック: 領域OCR選択
   * - 通常のダブルクリック: 全体OCR実行
   */
  function setupUnifiedClickHandlers() {
    console.log('統一されたクリック処理をセットアップしています...');
    
    // ビューワー要素を特定
    const viewerElement = findViewerElement();
    if (!viewerElement) {
      console.error('ビューワー要素が見つかりません。クリック処理をスキップします。');
      return;
    }
    
    console.log('ビューワー要素が見つかりました:', viewerElement);
    
    // 状態管理
    let altKeyPressed = false;
    let clickCount = 0;
    let clickTimer = null;
    let lastClickTime = 0;
    
    const DOUBLE_CLICK_DELAY = 400; // ダブルクリック判定時間
    
    // ALTキーの状態を監視
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Alt' || e.keyCode === 18) {
        altKeyPressed = true;
        console.log('ALTキー押下検出');
      }
    }, true);
    
    document.addEventListener('keyup', function(e) {
      if (e.key === 'Alt' || e.keyCode === 18) {
        altKeyPressed = false;
        console.log('ALTキー解放検出');
      }
    }, true);
    
    // ウィンドウフォーカス喪失時のリセット
    window.addEventListener('blur', function() {
      altKeyPressed = false;
      resetClickState();
    });
    
    // クリック状態をリセットする関数
    function resetClickState() {
      clickCount = 0;
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
    }
    
    // メインのクリックハンドラー
    function handleUnifiedClick(e) {
      // 無効化フラグをチェック
      if (window.clickHandlersDisabled !== true) {
        return; // まだ統一ハンドラーが有効でない場合はスキップ
      }
      
      const currentTime = Date.now();
      
      // 領域選択モード中はALTクリックを無効にする
      if (STATE.isSelecting) {
        console.log('領域選択モード中のため、ALT+クリック操作を無効化');
        return; // 早期リターンで処理を停止
      }

      // 処理中なら何もしない
      if (STATE.isProcessing) {
        console.log('OCR処理中のため、クリック操作をスキップします');
        return;
      }
      
      // 対象が画像またはビューワー内でない場合はスキップ
      if (e.target.tagName !== 'IMG' && !viewerElement.contains(e.target)) {
        return;
      }
      
      console.log('有効なクリックを検出:', {
        altKey: altKeyPressed,
        target: e.target.tagName,
        clickCount: clickCount + 1
      });
      
      // クリック回数をインクリメント
      clickCount++;
      
      // 既存のタイマーをクリア
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
      
      // ダブルクリック判定のタイマーを設定
      clickTimer = setTimeout(() => {
        console.log('最終クリック判定:', {
          clickCount: clickCount,
          altKeyPressed: altKeyPressed
        });
        
        executeClickAction(clickCount, altKeyPressed, e);
        resetClickState();
      }, DOUBLE_CLICK_DELAY);
      
      // イベントの伝播を制御
      if (altKeyPressed) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    
    // クリックアクションを実行する関数
    function executeClickAction(finalClickCount, wasAltPressed, originalEvent) {
      // APIキーをチェック
      chrome.storage.local.get(['geminiApiKey'], function(result) {
        if (!result.geminiApiKey) {
          showNotification('Gemini APIキーが設定されていません', 'error');
          return;
        }
        
        if (wasAltPressed) {
          // ALT+クリックの場合
          if (finalClickCount === 1) {
            console.log('ALT + シングルクリック: 全体OCR実行');
            processFullImage();
          }  else if (finalClickCount >= 2) {
            console.log('ALT + ダブルクリック: 領域OCR選択開始');
            
            // 画像の回転状態をチェック
            const img = findImageElement();
            const viewer = findViewerElement();
            if (img && viewer) {
              const transformInfo = getImageTransformInfo(img, viewer);
              let rotation = transformInfo.rotation % 360;
              if (rotation < 0) rotation += 360;
              
              // 90度または270度回転の場合は領域OCRを無効化
              if (rotation === 90 || rotation === 270) {
               // showNotification('90度/270度回転された画像には領域OCRは現在対応していません。全体OCRをご利用ください。', 'warning');
               // return;
              }
            }
            
            showNotification('領域OCR選択モードを起動しました', 'info', 2000);
            startAreaSelection();
          }
        } else {
          // 通常のクリック（ALTなし）の場合
          if (finalClickCount >= 2) {
            console.log('通常のダブルクリック: 全体OCR実行');
            processFullImage();
          }
          // シングルクリックは何もしない（通常の動作を維持）
        }
      });
    }
    
    // ビューワー要素にイベントリスナーを追加
    viewerElement.addEventListener('click', handleUnifiedClick, true);
    
    // 画像要素にも適用（より確実な検出のため）
    function addImageEventListeners() {
      const imageElements = viewerElement.querySelectorAll('img');
      imageElements.forEach(img => {
        // 重複を避けるため既存のリスナーを削除
        img.removeEventListener('click', handleUnifiedClick, true);
        // 新しいリスナーを追加
        img.addEventListener('click', handleUnifiedClick, true);
      });
    }
    
    // 初回の画像要素にイベントリスナーを追加
    addImageEventListeners();
    
    // 動的に追加される画像要素を監視
    const observer = new MutationObserver(function(mutations) {
      let shouldUpdateListeners = false;
      
      mutations.forEach(function(mutation) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(function(node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.tagName === 'IMG' || node.querySelector('img')) {
                shouldUpdateListeners = true;
              }
            }
          });
        }
      });
      
      if (shouldUpdateListeners) {
        setTimeout(addImageEventListeners, 100);
      }
    });
    
    // ビューワー要素の変更を監視
    observer.observe(viewerElement, {
      childList: true,
      subtree: true
    });
    
    // ページ離脱時にタイマーをクリア
    window.addEventListener('beforeunload', function() {
      resetClickState();
    });
    
    console.log('統一されたクリック処理のセットアップが完了しました');
    console.log('- ALT + シングルクリック: 全体OCR');
    console.log('- ALT + ダブルクリック: 領域OCR選択');
    console.log('- 通常のダブルクリック: 全体OCR');
  }

  // 既存の重複する関数を無効化する関数（安全版）
  function disableDuplicateClickHandlers() {
    console.log('重複するクリックハンドラーを無効化しています...');
    
    // DOM要素の置き換えはせず、フラグで制御
    window.clickHandlersDisabled = true;
    
    // 既存のグローバル関数を無効化
    if (typeof window.setupDoubleClickOcr === 'function') {
      window.setupDoubleClickOcr = function() {
        console.log('setupDoubleClickOcr は無効化されています');
      };
    }
    
    if (typeof window.setupAltClickOcr === 'function') {
      window.setupAltClickOcr = function() {
        console.log('setupAltClickOcr は無効化されています');
      };
    }
    
    console.log('重複するクリックハンドラーの無効化が完了しました');
  }







/**
 * ビューワー要素を探す補助関数
 */
function findViewerElement() {
  // 優先度順にセレクタを試す
  const selectors = [
    '#viewer-container',
    '.viewer-container',
    '.verfication-image-wrapper',
    '.viewer',
    '.image-container',
    // STREAMEDアプリでよく使われるセレクタ
    '.receipt-image-container',
    '.image-viewer-container'
  ];
  
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element;
    }
  }
  
  // フォールバック：画像要素を含む親要素
  const images = document.querySelectorAll('img');
  if (images.length > 0) {
    let largestImage = null;
    let maxArea = 0;
    
    images.forEach(img => {
      const area = (img.clientWidth || 0) * (img.clientHeight || 0);
      if (area > maxArea && img.offsetParent !== null) {
        maxArea = area;
        largestImage = img;
      }
    });
    
    if (largestImage) {
      return largestImage.parentElement;
    }
  }
  
  return null;
}



// OCRボタンの不透明度を調整する関数を追加
function updateOCRButtonsOpacity() {
  // 少し遅延させてボタンの存在を確実にする
  setTimeout(() => {
    const ocrButtons = document.querySelectorAll('.ocr-area-btn, .ocr-full-btn');
    ocrButtons.forEach(btn => {
      if (!btn.disabled) {
        // 初期不透明度を設定
        btn.style.opacity = '1';
        btn.style.transition = 'opacity 0.2s ease';
        
        // ホバーイベントを設定（既存のリスナーがあっても上書き）
        btn.onmouseenter = function() {
          if (!this.disabled) {
            this.style.opacity = '1';
          }
        };
        
        btn.onmouseleave = function() {
          if (!this.disabled) {
            this.style.opacity = '1';
          }
        };
      }
    });
  }, 100); // 100ms遅延
}
/**
 * 画像の回転状態を監視する
 */
function setupRotationWatcher() {
  // MutationObserverを使用して画像の変更を監視
  const observer = new MutationObserver(function(mutations) {
    let shouldUpdate = false;
    
    mutations.forEach(function(mutation) {
      // 画像のstyle属性が変更された場合
      if (mutation.type === 'attributes' && 
          mutation.attributeName === 'style' &&
          mutation.target.tagName === 'IMG') {
        shouldUpdate = true;
      }
      
      // ビューワー内のDOM変更を検出
      if (mutation.type === 'childList' && 
          (mutation.target.id === 'viewer-container' || 
           mutation.target.classList.contains('viewer-container'))) {
        shouldUpdate = true;
      }
    });
    
    if (shouldUpdate) {
      // 少し遅延させてボタン状態を更新（DOM更新完了後）
      setTimeout(updateOcrButtonStates, 300);
    }
  });
  
  // ビューワー要素を監視
  const viewer = findViewerElement();
  if (viewer) {
    observer.observe(viewer, { 
      attributes: true, 
      childList: true, 
      subtree: true,
      attributeFilter: ['style', 'class'] 
    });
  }
  
  // グローバル変数 main_angle の変更を監視（カスタムイベントリスナー）
  const originalSetAngle = window.set_angle;
  if (typeof originalSetAngle === 'function') {
    window.set_angle = function() {
      const result = originalSetAngle.apply(this, arguments);
      setTimeout(updateOcrButtonStates, 300);
      return result;
    };
  }
}







/**
 * グローバルスタイルを追加
 */
function addGlobalStyles() {
  const styleElement = document.createElement('style');
  styleElement.textContent = `
    /* OCR関連のグローバルスタイル */
    .ocr-button-group {
      position: absolute;
      left: -120px;
      top: 50%;
      transform: translateY(-50%);
      z-index: 100000 !important;
      background-color: rgba(255, 255, 255, 0.95);
      border-radius: 12px;
      padding: 15px;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
      pointer-events: auto !important;
      user-select: none;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(26, 115, 232, 0.2);
    }

    .ocr-vertical-tools {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 10px;
    }

    .ocr-large-btn {
      width: 90px;
      height: 80px;
      padding: 8px;
      background: linear-gradient(135deg, #1a73e8 0%, #1557b0 100%);
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
      box-shadow: 0 2px 8px rgba(26, 115, 232, 0.3);
      position: relative;
      overflow: hidden;
    }

    .ocr-large-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(26, 115, 232, 0.4);
      background: linear-gradient(135deg, #1e88e5 0%, #1976d2 100%);
    }

    .ocr-large-btn:active {
      transform: translateY(0);
      box-shadow: 0 2px 6px rgba(26, 115, 232, 0.3);
    }

    .ocr-large-btn:disabled {
      background: linear-gradient(135deg, #9e9e9e 0%, #757575 100%);
      cursor: not-allowed;
      transform: none;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .ocr-large-btn:disabled:hover {
      transform: none;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .ocr-btn-icon {
      font-size: 18px;
      margin-bottom: 2px;
      line-height: 1;
    }

    .ocr-btn-text {
      font-size: 11px;
      font-weight: 600;
      line-height: 1.2;
      margin-bottom: 1px;
    }

    .ocr-btn-desc {
      font-size: 8px;
      opacity: 0.9;
      line-height: 1.1;
      text-align: center;
    }

    .ocr-shortcut-info {
      font-size: 9px;
      color: #666;
      text-align: center;
      font-family: 'Courier New', monospace;
      background-color: rgba(240, 240, 240, 0.8);
      padding: 4px 8px;
      border-radius: 6px;
      border: 1px solid rgba(200, 200, 200, 0.5);
    }

    /* アニメーション効果 */
    @keyframes pulse {
      0% { box-shadow: 0 2px 8px rgba(26, 115, 232, 0.3); }
      50% { box-shadow: 0 2px 8px rgba(26, 115, 232, 0.6); }
      100% { box-shadow: 0 2px 8px rgba(26, 115, 232, 0.3); }
    }

    .ocr-large-btn.processing {
      animation: pulse 1.5s infinite;
    }

    /* レスポンシブ対応 */
    @media (max-width: 768px) {
      .ocr-button-group {
        left: -100px;
        padding: 10px;
      }
      
      .ocr-large-btn {
        width: 75px;
        height: 65px;
        padding: 6px;
      }
      
      .ocr-btn-icon {
        font-size: 16px;
      }
      
      .ocr-btn-text {
        font-size: 10px;
      }
      
      .ocr-btn-desc {
        font-size: 7px;
      }
    }

    .ocr-notification {
      position: fixed;
      top: 70px !important;
      left: 50%;
      transform: translateX(-50%);
      padding: 10px 20px;
      border-radius: 4px;
      z-index: 100000 !important;
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 14px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      text-align: center;
      min-width: 200px;
    }

    /* 選択モード関連スタイル */
    body.ocr-selecting {
      overflow: hidden !important;
    }

    .ocr-selection-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 99999 !important;
      background-color: rgba(0, 0, 0, 0.3);
      cursor: crosshair;
    }

    .ocr-overlay-text {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: white;
      font-size: 18px;
      font-weight: bold;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
    }

    .ocr-selection-box {
      position: absolute;
      border: 2px dashed red;
      background-color: rgba(255, 0, 0, 0.1);
      z-index: 100000 !important;
      pointer-events: none;
    }

    /* ダイアログスタイル */
    .ocr-field-dialog {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(0, 0, 0, 0.5);
      z-index: 100001 !important;
      display: flex;
      justify-content: center;
      align-items: center;
    }

    .ocr-field-dialog-content {
      background-color: white;
      padding: 20px;
      border-radius: 8px;
      width: 300px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
    }

    .ocr-field-options {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 15px;
    }

    .ocr-field-options button {
      padding: 10px;
      background-color: #1a73e8;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }

    .ocr-field-dialog-footer {
      display: flex;
      justify-content: center;
    }

    .ocr-cancel-btn {
      padding: 8px 15px;
      background-color: #6c757d;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }

    /* ドロップダウン関連のスタイル */
    .ocr-dropdown-container {
      position: absolute;
      z-index: 100001 !important;
      background-color: white;
      border: 1px solid #ccc;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      max-height: 200px;
      overflow-y: auto;
    }
    
    .ocr-dropdown-title {
      padding: 8px 12px;
      background-color: #f5f5f5;
      border-bottom: 1px solid #ccc;
      font-weight: bold;
      color: #333;
    }
    
    .ocr-dropdown-item {
      padding: 8px 12px;
      cursor: pointer;
      transition: background-color 0.2s;
    }
    
    .ocr-dropdown-item:hover {
      background-color: #f0f0f0;
    }
    
    .ocr-dropdown-item:last-child {
      border-bottom: none;
    }

    /* OCR Area Preview styles */
    .ocr-area-preview-container {
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
      display: flex;
      flex-direction: column;
      transition: opacity 0.3s ease;
    }

    .ocr-preview-header {
      width: 100%;
      padding: 5px 8px;
      background-color: #1a73e8;
      color: white;
      font-size: 12px;
      font-family: Arial, sans-serif;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: move;
    }

    .ocr-preview-controls {
      display: flex;
      gap: 5px;
    }

    .ocr-preview-close {
      cursor: pointer;
      padding: 0 5px;
      font-size: 14px;
    }

    .ocr-preview-image {
      width: 100%;
      height: auto;
      display: block;
      max-height: 300px;
      object-fit: contain;
    }

    .ocr-preview-status {
      padding: 5px 8px;
      font-size: 10px;
      background-color: #f5f5f5;
      color: #333;
      border-top: 1px solid #ddd;
      font-family: Arial, sans-serif;
    }

    .ocr-preview-status.success {
      background-color: #e8f5e9;
      color: #2e7d32;
    }

    .ocr-preview-status.error {
      background-color: #ffebee;
      color: #c62828;
    }

    /* Animation for the preview container */
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .ocr-area-preview-container {
      animation: fadeIn 0.3s ease;
    }

    /* Bubble dropdown styles */
    .ocr-bubble-dropdown {
      border-radius: 8px !important;
      box-shadow: 0 3px 10px rgba(0,0,0,0.3) !important;
      transition: opacity 0.3s ease, transform 0.2s ease !important;
      max-width: 300px !important;
      animation: fadeInBubble 0.3s ease !important;
    }
    
    @keyframes fadeInBubble {
      from { 
        opacity: 0; 
        transform: scale(0.9) translateX(-10px); 
      }
      to { 
        opacity: 1; 
        transform: scale(1) translateX(0); 
      }
    }
    
    .ocr-dropdown-item {
      white-space: normal !important;
      word-break: break-word !important;
    }  
  `;
  document.head.appendChild(styleElement);
}
  
  /**
   * APIキーの存在をチェックする
   */
  function checkApiKey() {
  chrome.runtime.sendMessage({action: "checkApiKey"}, function(result) {
    if (!result || !result.hasKey) {
      showNotification('Gemini APIキーが設定されていません。拡張機能の設定でAPIキーを設定してください。', 'error');
      
      // OCRボタンを無効化
      const ocrButtons = document.querySelectorAll('.ocr-area-btn, .ocr-full-btn');
      ocrButtons.forEach(btn => {
        btn.disabled = true;
        btn.title = 'APIキーが設定されていません';
        btn.style.opacity = '0.5';
      });
    } else if (!result.isValid) {
      showNotification('設定されたAPIキーが無効です。拡張機能の設定を確認してください。', 'error');
      
      // OCRボタンを無効化
      const ocrButtons = document.querySelectorAll('.ocr-area-btn, .ocr-full-btn');
      ocrButtons.forEach(btn => {
        btn.disabled = true;
        btn.title = 'APIキーが無効です';
        btn.style.opacity = '0.5';
      });
    }
  });
}
/**
 * STREAMED Dock サイト用のUI要素を追加
 * 画像ビューアとは独立したエレメントとして配置
 */
function addStreamedDockUi() {
  console.log('画像表示エリアを検索中...');
  
  // URLをチェックして、どのページにいるか判定
  const currentUrl = window.location.href;
  console.log('現在のURL:', currentUrl);
  
  let viewerArea = null;
  
  // 検証ページのケース
  if (currentUrl.includes('/verification')) {
    console.log('検証ページを検出しました');
    
    // 検証ページ固有のセレクター
    const verificationSelectors = [
      // 一般的なコンテナ
      '.verification-image-container',
      '.verification-content',
      '.image-viewer-container',
      '.image-display-area',
      '.receipt-image-container',
      // 画像を含む可能性のある要素
      'div:has(img)',
      '.content-area:has(img)',
      // フォールバック: 画像の親要素
      'img'
    ];
    
    for (const selector of verificationSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        if (elements && elements.length > 0) {
          // 画像を含む要素を見つける
          for (const element of elements) {
            // 要素自体が画像の場合は親要素を使用
            if (element.tagName === 'IMG') {
              viewerArea = element.parentElement;
              console.log('画像の親要素を検出:', element.parentElement);
              break;
            }
            
            // 子要素に画像があるか確認
            const containsImage = element.querySelector('img');
            if (containsImage) {
              viewerArea = element;
              console.log('画像コンテナを検出:', selector);
              break;
            }
          }
          if (viewerArea) break;
        }
      } catch (e) {
        console.error('セレクター検索エラー:', e);
      }
    }
    
    // 画像がある場所でビューワーが見つからない場合は、ページ内の画像を検索
    if (!viewerArea) {
      const images = document.querySelectorAll('img');
      if (images && images.length > 0) {
        // 最大の画像（領収書の可能性が高い）を見つける
        let maxWidth = 0;
        let largestImage = null;
        
        images.forEach(img => {
          const width = img.clientWidth || img.width || 0;
          if (width > maxWidth) {
            maxWidth = width;
            largestImage = img;
          }
        });
        
        if (largestImage) {
          viewerArea = largestImage.parentElement;
          console.log('最大の画像の親要素を使用:', largestImage);
        }
      }
    }
  } else {
    // 通常の領収書登録ページ
    viewerArea = document.querySelector('#viewer-container') || 
                document.querySelector('.viewer-container') || 
                document.querySelector('.verfication-image-wrapper');
  }
  
  // フォールバック：画像を直接検索
  if (!viewerArea) {
    const images = document.querySelectorAll('img');
    if (images && images.length > 0) {
      // 最初の表示されている画像を使用
      for (const img of images) {
        if (img.offsetParent !== null && (img.clientWidth > 100 || img.clientHeight > 100)) {
          // 画像が表示されており、ある程度のサイズがある場合
          viewerArea = img.parentElement;
          console.log('画像親要素をビューワーとして使用:', img);
          break;
        }
      }
    }
  }
  
  // 最終フォールバック：main要素またはbody要素
  if (!viewerArea) {
    viewerArea = document.querySelector('main') || document.body;
    console.log('フォールバック要素を使用:', viewerArea.tagName);
  }
  
  if (!viewerArea) {
    console.error('画像表示エリアが見つかりません。OCRボタンを追加できません。');
    // エラー通知を表示
    showNotification('画像表示エリアが見つかりません。OCRボタンを追加できません。', 'error');
    return;
  }
  
  console.log('画像表示エリアを検出:', viewerArea);
  
  // 既存のOCRボタングループを削除（重複防止）
  const existingButtonGroup = document.querySelector('.ocr-button-group');
  if (existingButtonGroup) {
    existingButtonGroup.remove();
  }
  
  // 画像ビューアの位置情報を取得
  const viewerRect = viewerArea.getBoundingClientRect();
  const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
  const scrollY = window.pageYOffset || document.documentElement.scrollTop;
  
  // 大きなボタン用のスタイルを先に追加（DOM追加前）
  const style = document.createElement('style');
  style.id = 'ocr-independent-styles';
  style.textContent = `
    .ocr-independent {
      background-color: rgba(255, 255, 255, 0.95);
      border-radius: 12px;
      padding: 15px;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
      pointer-events: auto !important;
      user-select: none;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(26, 115, 232, 0.2);
      transition: none;
      width: auto;
      height: auto;
    }
    
    .ocr-independent.loaded {
      transition: box-shadow 0.2s ease;
    }
    
    .ocr-vertical-tools {
      display: flex;
      flex-direction: column;
      gap: 15px;
      margin-bottom: 12px;
    }
    
    .ocr-large-btn {
      width: 110px;
      height: 100px;
      padding: 10px;
      background: linear-gradient(135deg, #1a73e8 0%, #1557b0 100%);
      color: white;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
      box-shadow: 0 3px 10px rgba(26, 115, 232, 0.3);
      position: relative;
      overflow: hidden;
      transform: scale(1) !important;
      flex-shrink: 0;
    }
    
    .ocr-large-btn:hover {
      box-shadow: 0 4px 15px rgba(26, 115, 232, 0.4);
      background: linear-gradient(135deg, #1e88e5 0%, #1976d2 100%);
    }
    
    .ocr-large-btn:active {
      transform: none !important;
      box-shadow: 0 2px 8px rgba(26, 115, 232, 0.3);
    }
    
    .ocr-large-btn:disabled {
      background: linear-gradient(135deg, #9e9e9e 0%, #757575 100%);
      cursor: not-allowed;
      transform: none;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }
    
    .ocr-large-btn:disabled:hover {
      transform: none;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }
    
    .ocr-btn-icon {
      font-size: 22px;
      margin-bottom: 4px;
      line-height: 1;
    }
    
    .ocr-btn-text {
      font-size: 13px;
      font-weight: 600;
      line-height: 1.2;
      margin-bottom: 2px;
    }
    
    .ocr-btn-desc {
      font-size: 9px;
      opacity: 0.9;
      line-height: 1.1;
      text-align: center;
    }
    
    .ocr-shortcut-info {
      font-size: 9px;
      color: #666;
      text-align: center;
      font-family: 'Courier New', monospace;
      background-color: rgba(240, 240, 240, 0.8);
      padding: 4px 8px;
      border-radius: 6px;
      border: 1px solid rgba(200, 200, 200, 0.5);
    }
    
    @keyframes pulse {
      0% { box-shadow: 0 2px 8px rgba(26, 115, 232, 0.3); }
      50% { box-shadow: 0 2px 8px rgba(26, 115, 232, 0.6); }
      100% { box-shadow: 0 2px 8px rgba(26, 115, 232, 0.3); }
    }
    
    .ocr-large-btn.processing {
      animation: pulse 1.5s infinite;
      background: linear-gradient(135deg, #ff9800 0%, #f57400 100%);
    }
    
    .ocr-large-btn.processing:hover {
      background: linear-gradient(135deg, #ffa726 0%, #ff8f00 100%);
    }
    
    @media (max-width: 768px) {
      .ocr-independent {
        padding: 12px;
      }
      
      .ocr-large-btn {
        width: 95px;
        height: 85px;
        padding: 8px;
        flex-shrink: 0;
      }
      
      .ocr-btn-icon {
        font-size: 20px;
      }
      
      .ocr-btn-text {
        font-size: 12px;
      }
      
      .ocr-btn-desc {
        font-size: 8px;
      }
    }
    
    @media (max-width: 1200px) {
      .ocr-independent {
        transform: translateX(0) !important;
      }
    }
  `;
  document.head.appendChild(style);
  
  // OCRボタングループを作成
  const ocrButtonGroup = document.createElement('div');
  ocrButtonGroup.className = 'ocr-button-group ocr-independent';
  ocrButtonGroup.id = 'ocr-independent-buttons';
  
  ocrButtonGroup.innerHTML = `
    <div class="ocr-vertical-tools">
      <button type="button" class="ocr-area-btn ocr-large-btn">
        <div class="ocr-btn-icon">🎯</div>
        <div class="ocr-btn-text">領域OCR</div>
        <div class="ocr-btn-desc">ドラッグで範囲選択</div>
      </button>
      <button type="button" class="ocr-full-btn ocr-large-btn">
        <div class="ocr-btn-icon">📄</div>
        <div class="ocr-btn-text">全体OCR</div>
        <div class="ocr-btn-desc">画像全体を認識</div>
      </button>
    </div>
    <div class="ocr-shortcut-info">
      Alt+Shift+Z
    </div>
  `;
  
  // 独立エレメントとしてbodyに追加
  document.body.appendChild(ocrButtonGroup);
  
  // ビューアの位置を基準とした絶対位置を計算して設定
  let lastKnownPosition = { left: 0, top: 0 }; // 最後の位置を記録
  let isInitialPositionSet = false; // 初期位置設定完了フラグ
  
  function updateButtonPosition() {
    // 初期位置設定が完了するまでは位置更新しない
    if (!isInitialPositionSet) {
      return;
    }
    
    const currentViewerRect = viewerArea.getBoundingClientRect();
    const currentScrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const currentScrollY = window.pageYOffset || document.documentElement.scrollTop;
    
    // ビューア左側の外側に配置（120px離す）
    const leftPosition = currentViewerRect.left + currentScrollX - 120;
    const topPosition = currentViewerRect.top + currentScrollY + (currentViewerRect.height / 2) - (ocrButtonGroup.offsetHeight / 2);
    
    // 画面外に出ないように調整
    const finalLeft = Math.max(10, leftPosition);
    const finalTop = Math.max(10, Math.min(topPosition, window.innerHeight - ocrButtonGroup.offsetHeight - 10));
    
    // 位置に大きな変化がある場合のみ更新（閾値を大幅に増加）
    const positionThreshold = 15; // 5px → 15px に拡大
    if (Math.abs(finalLeft - lastKnownPosition.left) > positionThreshold || 
        Math.abs(finalTop - lastKnownPosition.top) > positionThreshold) {
      
      ocrButtonGroup.style.left = finalLeft + 'px';
      ocrButtonGroup.style.top = finalTop + 'px';
      
      // 最後の位置を更新
      lastKnownPosition = { left: finalLeft, top: finalTop };
    }
  }
  
  // ボタンにユーザー相互作用の監視を追加
  function addInteractionListeners() {
    const buttons = ocrButtonGroup.querySelectorAll('.ocr-large-btn');
    
    buttons.forEach(button => {
      // マウス進入時
      button.addEventListener('mouseenter', () => {
        isUserInteracting = true;
        console.log('ユーザー相互作用開始 - 位置更新を一時停止');
      });
      
      // マウス離脱時
      button.addEventListener('mouseleave', () => {
        // 少し遅延させてから相互作用フラグを解除
        setTimeout(() => {
          isUserInteracting = false;
          console.log('ユーザー相互作用終了 - 位置更新を再開');
        }, 500); // 500ms遅延でクリック完了を待つ
      });
      
      // クリック開始時
      button.addEventListener('mousedown', () => {
        isUserInteracting = true;
      });
      
      // クリック終了時
      button.addEventListener('mouseup', () => {
        // クリック後も少し待ってからフラグを解除
        setTimeout(() => {
          isUserInteracting = false;
        }, 300);
      });
      
      // フォーカス時
      button.addEventListener('focus', () => {
        isUserInteracting = true;
      });
      
      // フォーカス離脱時
      button.addEventListener('blur', () => {
        setTimeout(() => {
          isUserInteracting = false;
        }, 200);
      });
    });
    
    // ボタングループ全体への相互作用監視
    ocrButtonGroup.addEventListener('mouseenter', () => {
      isUserInteracting = true;
    });
    
    ocrButtonGroup.addEventListener('mouseleave', () => {
      setTimeout(() => {
        isUserInteracting = false;
      }, 500);
    });
  }
  
  // 初期位置を設定（完全に静的なアプローチ）
  const currentViewerRect = viewerArea.getBoundingClientRect();
  const currentScrollX = window.pageXOffset || document.documentElement.scrollLeft;
  const currentScrollY = window.pageYOffset || document.documentElement.scrollTop;
  
  const leftPosition = currentViewerRect.left + currentScrollX - 120;
  const topPosition = currentViewerRect.top + currentScrollY + (currentViewerRect.height / 2) - 90;
  
  const finalLeft = Math.max(10, leftPosition);
  const finalTop = Math.max(10, Math.min(topPosition, window.innerHeight - 200));
  
  // 完全静的配置（一切の後続変更を無効化）
  ocrButtonGroup.style.cssText = `
    position: absolute !important;
    left: ${finalLeft}px !important;
    top: ${finalTop}px !important;
    z-index: 100000 !important;
    opacity: 1 !important;
    visibility: visible !important;
    transition: none !important;
    transform: scale(1) !important;
    pointer-events: auto !important;
  `;
  
  // DOM追加は一度だけ（完全準備済み）
  document.body.appendChild(ocrButtonGroup);
  
  // 位置記録と更新完全無効化
  lastKnownPosition = { left: finalLeft, top: finalTop };
  isInitialPositionSet = true;
  
  // 全ての位置更新を無効化
  function updateButtonPosition() {
    return; // 何もしない
  }
  
  // イベントリスナーを即座に追加（遅延なし）
  addInteractionListeners();
  ocrButtonGroup.classList.add('loaded');
  
  // スクロールとリサイズ時に位置を更新
  let positionUpdateTimer = null;
  let isUserInteracting = false; // ユーザーがボタンと相互作用中かのフラグ
  
  function schedulePositionUpdate() {
    // ユーザーがボタンと相互作用中は位置更新をスキップ
    if (isUserInteracting) {
      return;
    }
    
    if (positionUpdateTimer) {
      clearTimeout(positionUpdateTimer);
    }
    positionUpdateTimer = setTimeout(updateButtonPosition, 500); // 200ms → 500ms さらに遅延
  }
  
  window.addEventListener('scroll', schedulePositionUpdate);
  window.addEventListener('resize', schedulePositionUpdate);
  
  // ビューア要素のサイズ変更を監視
  let resizeObserver = null;
  if (window.ResizeObserver) {
    resizeObserver = new ResizeObserver(() => {
      // リサイズ時はさらに遅延を増やして飛び跳ね防止
      if (positionUpdateTimer) {
        clearTimeout(positionUpdateTimer);
      }
      positionUpdateTimer = setTimeout(updateButtonPosition, 800); // 即座実行を避ける
    });
    resizeObserver.observe(viewerArea);
  }
  
  // MutationObserverでボタングループの削除を監視
  let buttonMutationObserver = null;
  if (window.MutationObserver) {
    buttonMutationObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          // 削除されたノードの中にボタングループがあるかチェック
          mutation.removedNodes.forEach((node) => {
            if (node === ocrButtonGroup || (node.nodeType === Node.ELEMENT_NODE && node.contains(ocrButtonGroup))) {
              console.log('OCRボタングループが削除されました。オブザーバーを停止します。');
              if (resizeObserver) {
                resizeObserver.disconnect();
                resizeObserver = null;
              }
              if (buttonMutationObserver) {
                buttonMutationObserver.disconnect();
                buttonMutationObserver = null;
              }
              // イベントリスナーも削除
              window.removeEventListener('scroll', schedulePositionUpdate);
              window.removeEventListener('resize', schedulePositionUpdate);
            }
          });
        }
      });
    });
    
    // body要素の変更を監視（ボタングループがbodyの直接の子なので）
    buttonMutationObserver.observe(document.body, {
      childList: true,
      subtree: false // bodyの直接の子のみ監視
    });
  }
  
  console.log('独立したOCRボタンを追加しました', ocrButtonGroup);
  
  // ドラッグ機能を実装（独立エレメント用）
  makeDraggableIndependent(ocrButtonGroup, updateButtonPosition);
  
  // 定期的な位置チェック（ビューアが移動した場合の対応）
  const positionChecker = setInterval(() => {
    if (!document.body.contains(ocrButtonGroup)) {
      console.log('OCRボタングループが存在しないため、定期チェックを停止します。');
      clearInterval(positionChecker);
      window.removeEventListener('scroll', schedulePositionUpdate);
      window.removeEventListener('resize', schedulePositionUpdate);
      
      // オブザーバーも停止
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (buttonMutationObserver) {
        buttonMutationObserver.disconnect();
        buttonMutationObserver = null;
      }
      return;
    }
    
    // ビューア要素が存在しなくなった場合
    if (!document.body.contains(viewerArea)) {
      console.log('ビューア要素が削除されました。OCRボタンも削除します。');
      ocrButtonGroup.remove();
      clearInterval(positionChecker);
      return;
    }
    
    // ユーザーが相互作用中でなければ位置更新（頻度を大幅に下げる）
    if (!isUserInteracting) {
      updateButtonPosition();
    }
  }, 10000); // 5秒 → 10秒 さらに頻度を下げる
}

/**
 * 独立エレメント用のドラッグ機能（相互作用フラグ対応版）
 * @param {HTMLElement} element - ドラッグ可能にする要素
 * @param {Function} positionUpdateCallback - 位置更新のコールバック
 */
function makeDraggableIndependent(element, positionUpdateCallback) {
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  let isDragging = false;
  
  element.style.cursor = 'move';
  element.onmousedown = dragMouseDown;
  
  function dragMouseDown(e) {
    // ボタン自体をクリックした場合はドラッグを開始しない
    if (e.target.classList.contains('ocr-large-btn') || 
        e.target.closest('.ocr-large-btn')) {
      return;
    }
    
    e.preventDefault();
    isDragging = true;
    
    // ドラッグ中は位置更新を無効化
    if (typeof isUserInteracting !== 'undefined') {
      isUserInteracting = true;
    }
    
    // 開始時のカーソル位置を取得
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    document.onmousemove = elementDrag;
    
    // ドラッグ中のスタイル
    element.style.transition = 'none';
    element.style.transform = 'scale(1.05)';
  }
  
  function elementDrag(e) {
    if (!isDragging) return;
    
    e.preventDefault();
    // 新しい位置を計算
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    
    // 現在の位置を取得
    const currentLeft = parseInt(element.style.left) || 0;
    const currentTop = parseInt(element.style.top) || 0;
    
    // 新しい位置を計算
    let newTop = currentTop - pos2;
    let newLeft = currentLeft - pos1;
    
    // 画面の境界をチェック
    const maxX = window.innerWidth - element.offsetWidth;
    const maxY = window.innerHeight - element.offsetHeight;
    
    // 範囲内に収める
    newTop = Math.max(0, Math.min(maxY, newTop));
    newLeft = Math.max(0, Math.min(maxX, newLeft));
    
    // 要素の新しい位置を設定
    element.style.top = newTop + "px";
    element.style.left = newLeft + "px";
  }
  
  function closeDragElement() {
    isDragging = false;
    
    // ドラッグ終了時のスタイル復元
    element.style.transition = 'all 0.3s ease';
    element.style.transform = 'scale(1)';
    
    // マウスボタンが離されたら移動を停止
    document.onmouseup = null;
    document.onmousemove = null;
    
    // ドラッグ終了後に相互作用フラグを解除（少し遅延）
    setTimeout(() => {
      if (typeof isUserInteracting !== 'undefined') {
        isUserInteracting = false;
      }
    }, 500);
    
    // 位置更新コールバックを無効化（手動配置を維持）
    // positionUpdateCallback は呼び出さない
  }
}





  
 
  
  
  /**
   * イベントリスナーの設定
   */

function setupEventListeners() {

  // 領域選択ボタン
  const areaButton = document.querySelector('.ocr-area-btn');
  if (areaButton) {
    areaButton.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      
      console.log('領域OCRボタンがクリックされました');
      
      // 処理中なら何もしない
      if (STATE.isProcessing) {
        console.log('OCR処理中のため、領域選択をスキップします');
        showNotification('OCR処理中です。しばらくお待ちください', 'info');
        return;
      }
      
      startAreaSelection();
    });
  }
  
  // 全体OCRボタン（改善版）
  const fullButton = document.querySelector('.ocr-full-btn');
  if (fullButton) {
    fullButton.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      
      console.log('全体OCRボタンがクリックされました');
      
      // 処理中なら何もしない
      if (STATE.isProcessing) {
        console.log('OCR処理中のため、全体OCRをスキップします');
        showNotification('OCR処理中です。しばらくお待ちください', 'info');
        return;
      }
      
      // 領域選択中の場合は選択モードを終了してから全体OCRを実行
      if (STATE.isSelecting) {
        console.log('領域選択中です。選択モードを終了して全体OCRを実行します');
        showNotification('領域選択をキャンセルして全体OCRを実行します', 'info', 2000);
        
        // 選択モードを強制終了
        endAreaSelection();
        
        // 少し遅延させてから全体OCRを実行（UI更新完了を待つ）
        setTimeout(() => {
          processFullImage();
        }, 100);
      } else {
        // 通常の全体OCR実行
        processFullImage();
      }
    });
  }
  
  // 入力フィールドをフォーカスした時のイベントリスナー
  const inputFields = document.querySelectorAll('[data-input-text]');
  inputFields.forEach(field => {
    field.addEventListener('focus', function() {
      highlightField(this);
    });
    
    field.addEventListener('blur', function() {
      removeHighlight(this);
    });
  });
  
  // キーボードショートカット（改善版）
  document.addEventListener('keydown', function(e) {
    // Alt+Shift+Z (Alt: 18, Shift: 16, Z: 90)
    if (e.altKey && e.shiftKey && e.keyCode === 90) {
      e.preventDefault();
      e.stopPropagation();
      
      console.log('Alt+Shift+Z ショートカットが押されました');
      
      // 処理中なら何もしない
      if (STATE.isProcessing) {
        console.log('OCR処理中のため、ショートカットをスキップします');
        showNotification('OCR処理中です。しばらくお待ちください', 'info');
        return;
      }
      
      // 領域選択中の場合は選択モードを終了してから全体OCRを実行
      if (STATE.isSelecting) {
        console.log('ショートカット: 領域選択中です。選択モードを終了して全体OCRを実行します');
        showNotification('領域選択をキャンセルして全体OCRを実行します', 'info', 2000);
        
        // 選択モードを強制終了
        endAreaSelection();
        
        // 少し遅延させてから全体OCRを実行
        setTimeout(() => {
          processFullImage();
        }, 100);
      } else {
        // 通常の全体OCR実行
        const fullOcrButton = document.querySelector('.ocr-full-btn');
        if (fullOcrButton) {
          console.log('ショートカット: 全体OCRボタンをクリックします');
          fullOcrButton.click();
        } else {
          console.log('ショートカット: 全体OCR処理を直接呼び出し');
          processFullImage();
        }
      }
    }
    
    // Escキーで領域選択をキャンセル
    if (e.keyCode === 27 && STATE.isSelecting) { // Escキー
      e.preventDefault();
      e.stopPropagation();
      
      console.log('Escキーで領域選択をキャンセルします');
      showNotification('領域選択をキャンセルしました', 'info', 2000);
      endAreaSelection();
    }
  });
  // スペースキーリスナーを追加
  setupSpaceKeyListener();

}
// 履歴ドロップダウン用のスタイルを追加
const historyStyles = document.createElement('style');
historyStyles.textContent = `
  .payee-history-dropdown .ocr-preview-header,
  .payee-history-dropdown div:first-child {
    background-color: #e6e0f8 !important;
    color: #4a3a6b !important;
  }
  
  .payee-history-dropdown {
    border-color: #e6e0f8 !important;
  }
  
  .payee-history-dropdown .ocr-dropdown-title {
    background-color: #e6e0f8 !important;
    color: #4a3a6b !important;
    font-weight: bold;
  }
  
  .payee-history-dropdown .ocr-dropdown-item {
    border-left: 3px solid #e6e0f8;
    padding-left: 15px;
  }
  
  .payee-history-dropdown .ocr-dropdown-item:hover {
    background-color: #d5c9f0 !important;
    color: #4a3a6b !important;
  }
`;

document.head.appendChild(historyStyles);
  /**
   * フィールドをハイライト表示
   */
  function highlightField(field) {
    // 現在のフォーカスフィールドをグローバル変数に保存
    window.currentFocusField = field;
    
    // ハイライトクラスを追加
    field.classList.add('ocr-field-highlight');
  }
  
  /**
   * フィールドのハイライトを解除
   */
  function removeHighlight(field) {
    field.classList.remove('ocr-field-highlight');
  }
  
/**
 * 領域選択モードを開始（改善版）
 * ボタン状態の視覚的フィードバック付き
 * @param {string} [predefinedFieldType] - 事前に指定されたフィールドタイプ
 */
function startAreaSelection(predefinedFieldType) {
  
    // ===== 追加: ロックチェック =====
  if (!window.globalOcrLock.acquire()) {
    showNotification('OCR処理中です。しばらくお待ちください', 'info');
    return;
  }
  // ===============================
  
  
  console.log('領域選択モード開始処理を開始します');
  
  

  // APIキーをチェック
  chrome.runtime.sendMessage({action: "checkApiKey"}, function(result) {
    if (!result || !result.hasKey || !result.isValid) {
      showNotification('Gemini APIキーが設定されていないか無効です', 'error');
      window.globalOcrLock.release(); // ロック解除を追加
      return;
    }
    
    // 既に選択中ならキャンセル
    if (STATE.isSelecting) {
      console.log('既に領域選択中のため、選択モードを終了します');
      endAreaSelection();
      return;
    }
    
    // 画像ビューワーを探す
    const viewer = findViewerElement();
    if (!viewer) {
      showNotification('画像ビューワーが見つかりません', 'error');
      return;
    }
    
    // 画像を探す
    const img = findImageElement();
    if (!img) {
      showNotification('画像が見つかりません', 'error');
      return;
    }
    
    // 画像の変換情報を取得
    const transformInfo = getImageTransformInfo(img, viewer);
    
    // 回転角度の正規化（-90度を270度として扱うなど）
    let rotation = transformInfo.rotation % 360;
    if (rotation < 0) rotation += 360; // マイナスの角度を正の角度に変換
    
    // 90度または270度回転の場合、領域選択を無効にする
    if (rotation === 90 || rotation === 270) {
     // showNotification('90度/270度回転された画像には領域OCRは現在対応していません。全体OCRをご利用ください。', 'warning');
      //return;
    }
    
    // 選択モード開始
    STATE.isSelecting = true;
    console.log('領域選択モードを開始しました');
    
    // 事前に指定されたフィールドタイプがある場合は保存
    if (predefinedFieldType) {
      STATE.predefinedFieldType = predefinedFieldType;
    }
    
    // 領域選択ボタンの表示を更新
    const areaButton = document.querySelector('.ocr-area-btn');
    if (areaButton) {
      areaButton.classList.add('processing');
      
      // ボタンテキストを更新
      const iconDiv = areaButton.querySelector('.ocr-btn-icon');
      const textDiv = areaButton.querySelector('.ocr-btn-text');
      const descDiv = areaButton.querySelector('.ocr-btn-desc');
      
      if (iconDiv) iconDiv.textContent = '⏹️';
      if (textDiv) textDiv.textContent = 'キャンセル';
      if (descDiv) descDiv.textContent = '選択を中止';
    }
    
    // body にクラスを追加して画像のドラッグとスクロールを防止
    document.body.classList.add('ocr-selecting');
    document.body.style.overflow = 'hidden';
    
    // 選択オーバーレイを作成
    const overlay = document.createElement('div');
    overlay.className = 'ocr-selection-overlay';
    
    // オーバーレイテキストを追加
    const overlayText = document.createElement('div');
    overlayText.className = 'ocr-overlay-text';
    overlayText.innerHTML = `
      認識したい領域を選択してください<br>
      <small style="font-size: 14px; opacity: 0.8;">
        Escキーまたは全体OCRボタンでキャンセル
      </small>
    `;
    //overlay.appendChild(overlayText);
    
    viewer.appendChild(overlay);
    
    // 選択ボックスを作成
    const selectionBox = document.createElement('div');
    selectionBox.className = 'ocr-selection-box';
    viewer.appendChild(selectionBox);
    STATE.selectionBox = selectionBox;
    
    // マウスダウンイベント
    overlay.addEventListener('mousedown', handleMouseDown);
    
    // 通知
    showNotification('領域を選択してください（Escキーでキャンセル）', 'info');
    
    console.log('領域選択モードの初期化が完了しました');
  });
}
  
/**
 * 領域選択モードを終了（改善版）
 * より確実なクリーンアップとログ出力
 */
function endAreaSelection() {
  console.log('領域選択モード終了処理を開始します');
  
  // 選択モード終了
  const wasSelecting = STATE.isSelecting;
  STATE.isSelecting = false;
  
  // 事前に指定されたフィールドタイプをクリア
  STATE.predefinedFieldType = null;
  
  // body からクラスを削除
  if (document.body.classList.contains('ocr-selecting')) {
    document.body.classList.remove('ocr-selecting');
    console.log('body から ocr-selecting クラスを削除しました');
  }
  
  // スクロール制限を解除
  if (document.body.style.overflow === 'hidden') {
    document.body.style.overflow = '';
    console.log('スクロール制限を解除しました');
  }
  
  // 選択オーバーレイを削除
  const overlays = document.querySelectorAll('.ocr-selection-overlay');
  overlays.forEach(overlay => {
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
      console.log('選択オーバーレイを削除しました');
    }
  });
  
  // 選択ボックスを削除
  if (STATE.selectionBox) {
    if (STATE.selectionBox.parentNode) {
      STATE.selectionBox.parentNode.removeChild(STATE.selectionBox);
      console.log('選択ボックスを削除しました');
    }
    STATE.selectionBox = null;
  }
  
  // 追加で残っている可能性のある選択ボックスも削除
  const selectionBoxes = document.querySelectorAll('.ocr-selection-box');
  selectionBoxes.forEach(box => {
    if (box && box.parentNode) {
      box.parentNode.removeChild(box);
      console.log('残存する選択ボックスを削除しました');
    }
  });
  
  // イベントリスナーを削除
  document.removeEventListener('mousemove', handleMouseMove);
  document.removeEventListener('mouseup', handleMouseUp);
  console.log('マウスイベントリスナーを削除しました');
  
  // 処理フラグも解除（選択処理の中断）
  setProcessingFlag(false);
  
  // 領域選択ボタンの状態を更新
  const areaButton = document.querySelector('.ocr-area-btn');
  if (areaButton) {
    areaButton.classList.remove('processing');
    if (areaButton.textContent.includes('キャンセル')) {
      // ボタンテキストを元に戻す
      const iconDiv = areaButton.querySelector('.ocr-btn-icon');
      const textDiv = areaButton.querySelector('.ocr-btn-text');
      const descDiv = areaButton.querySelector('.ocr-btn-desc');
      
      if (iconDiv) iconDiv.textContent = '🎯';
      if (textDiv) textDiv.textContent = '領域OCR';
      if (descDiv) descDiv.textContent = 'ドラッグで範囲選択';
    }
  }
  
  if (wasSelecting) {
    console.log('領域選択モードを正常に終了しました');
  } else {
    console.log('領域選択モードは既に終了していました');
  }
}
  
  /**
   * マウスダウンイベントハンドラ
   */
  function handleMouseDown(e) {
    // イベントのデフォルト動作とバブリングを防止
    e.preventDefault();
    e.stopPropagation();
    
    // 画像ビューワーを探す（複数のセレクターで試行）
    const viewer = document.querySelector('#viewer-container .viewer') || 
                 document.querySelector('.viewer-container .viewer') || 
                 document.querySelector('.verfication-image-wrapper') ||
                 document.querySelector('#viewer-container') ||
                 document.querySelector('.viewer-container') ||
                 e.currentTarget.parentElement; // 親要素も試す
                 
    if (!viewer) return;
    
    const viewerRect = viewer.getBoundingClientRect();
    STATE.startX = e.clientX - viewerRect.left;
    STATE.startY = e.clientY - viewerRect.top;
    
    if (STATE.selectionBox) {
      STATE.selectionBox.style.left = STATE.startX + 'px';
      STATE.selectionBox.style.top = STATE.startY + 'px';
      STATE.selectionBox.style.width = '0px';
      STATE.selectionBox.style.height = '0px';
      STATE.selectionBox.style.display = 'block';
    }
    
    // イベントリスナーを追加
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }
  
  /**
   * マウス移動イベントハンドラ
   */
  function handleMouseMove(e) {
    if (!STATE.isSelecting || !STATE.selectionBox) return;
    
    // イベントのデフォルト動作とバブリングを防止
    e.preventDefault();
    e.stopPropagation();
    
    // 画像ビューワーを探す（複数のセレクターで試行）
    const viewer = document.querySelector('#viewer-container .viewer') || 
                 document.querySelector('.viewer-container .viewer') || 
                 document.querySelector('.verfication-image-wrapper') ||
                 document.querySelector('#viewer-container') ||
                 document.querySelector('.viewer-container') ||
                 STATE.selectionBox.parentElement; // 親要素も試す
                 
    if (!viewer) return;
    
    const viewerRect = viewer.getBoundingClientRect();
    const currentX = e.clientX - viewerRect.left;
    const currentY = e.clientY - viewerRect.top;
    
    const width = currentX - STATE.startX;
    const height = currentY - STATE.startY;
    
    STATE.selectionBox.style.left = (width > 0 ? STATE.startX : currentX) + 'px';
    STATE.selectionBox.style.top = (height > 0 ? STATE.startY : currentY) + 'px';
    STATE.selectionBox.style.width = Math.abs(width) + 'px';
    STATE.selectionBox.style.height = Math.abs(height) + 'px';
  }
  
  /**
   * マウスアップイベントハンドラ
   */
  function handleMouseUp(e) {
    // イベントのデフォルト動作とバブリングを防止
    e.preventDefault();
    e.stopPropagation();
    
    if (!STATE.isSelecting || !STATE.selectionBox) return;
    
    // 選択範囲のサイズを取得
    const width = parseInt(STATE.selectionBox.style.width) || 0;
    const height = parseInt(STATE.selectionBox.style.height) || 0;
    
    // 小さすぎる選択は無効とする
    if (width < 10 || height < 10) {
      showNotification('選択範囲が小さすぎます', 'warning');
      endAreaSelection();
      setProcessingFlag(false); // 処理フラグも解除
      return;
    }
    
    // 選択範囲の情報
    const selectionArea = {
      x: parseInt(STATE.selectionBox.style.left) || 0,
      y: parseInt(STATE.selectionBox.style.top) || 0,
      width: width,
      height: height
    };
    
    // 事前に指定されたフィールドタイプがある場合はそれを使用
    let fieldType = STATE.predefinedFieldType;
    
    // 事前指定がない場合はフォーカスされたフィールドから判定
    if (!fieldType) {
      fieldType = getFieldTypeFromFocusedElement();
    }
    
    // フィールドタイプが確定していない場合はデフォルトで支払先名(payee-name)を使用
    if (!fieldType) {
      fieldType = 'payee-name';
      // 支払先名フィールドにフォーカス
      focusFieldByType(fieldType);
    }
    
    // 領域を処理
    processImageRegion(selectionArea, fieldType);
    
    // イベントリスナーを削除
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }
  
  /**
   * フォーカスされた要素からフィールドタイプを判定
   */
  function getFieldTypeFromFocusedElement() {
    if (!window.currentFocusField) return null;
    
    const dataAttr = window.currentFocusField.getAttribute('data-input-text');
    
    if (dataAttr === 'phone-number') return 'phone-number';
    if (dataAttr === 'payee-name') return 'payee-name';
    if (dataAttr === 'phonetic') return 'phonetic';
    
    return null;
  }
  /**
 * OCRボタンの状態を更新する関数
 */
function updateOcrButtonStates() {
  const areaButton = document.querySelector('.ocr-area-btn');
  if (!areaButton) return;
  
  // 画像を探す
  const img = findImageElement();
  if (!img) return;
  
  // ビューワー要素を探す
  const viewer = findViewerElement();
  if (!viewer) return;
  
  // 画像の変換情報を取得
  const transformInfo = getImageTransformInfo(img, viewer);
  
  // 回転角度の正規化
  let rotation = transformInfo.rotation % 360;
  if (rotation < 0) rotation += 360;
  
  // 90度または270度回転の場合、領域OCRボタンを無効化
  if (rotation === 90 || rotation === 270) {
   // areaButton.disabled = true;
   // areaButton.style.opacity = '0.5';
   // areaButton.title = '90度/270度回転された画像には領域OCRは現在対応していません';
    
    // ボタンにビジュアル表示を追加
   // areaButton.innerHTML = '<i class="fa fa-crop"></i> 領域OCR (無効)';
  } else {
    areaButton.disabled = false;
    areaButton.style.opacity = '1';
    areaButton.title = '選択した領域をOCR認識';
    areaButton.innerHTML = '<i class="fa fa-crop"></i> 領域OCR';
  }
}

  /**
   * タイプに応じたフィールドにフォーカス
   */
  function focusFieldByType(fieldType) {
    let field = null;
    
    switch (fieldType) {
      case 'phone-number':
        field = document.querySelector('[data-input-text="phone-number"]');
        break;
      case 'payee-name':
        field = document.querySelector('[data-input-text="payee-name"]');
        break;
      case 'phonetic':
        field = document.querySelector('[data-input-text="phonetic"]');
        break;
    }
    
    if (field) {
      field.focus();
      window.currentFocusField = field;
    }
  }
  
  

/**
 * 回転を考慮した画像変換情報取得の改良版
 */
function getImageTransformInfo(imgElement, viewerElement) {
  const naturalWidth = imgElement.naturalWidth || imgElement.width;
  const naturalHeight = imgElement.naturalHeight || imgElement.height;
  
  const displayRect = imgElement.getBoundingClientRect();
  const displayWidth = displayRect.width;
  const displayHeight = displayRect.height;
  
  console.group('画像変換情報の詳細分析');
  console.log('自然サイズ:', { width: naturalWidth, height: naturalHeight });
  console.log('表示サイズ:', { width: displayWidth, height: displayHeight });
  
  // 回転角度の検出（複数ソースから）
  let rotation = 0;
  
  // 1. グローバル変数からの検出
  if (typeof window.main_angle !== 'undefined') {
    rotation = window.main_angle;
    console.log('グローバル変数から回転角度:', rotation);
  }
  
  // 2. CSS transform からの検出
  try {
    const computedStyle = window.getComputedStyle(imgElement);
    const transformValue = computedStyle.transform;
    
    if (transformValue && transformValue !== 'none') {
      const matrix = transformValue.match(/matrix\((.+)\)/);
      if (matrix) {
        const values = matrix[1].split(', ');
        if (values.length >= 6) {
          const a = parseFloat(values[0]);
          const b = parseFloat(values[1]);
          const cssRotation = Math.round(Math.atan2(b, a) * (180 / Math.PI));
          if (cssRotation !== 0) {
            rotation = cssRotation;
            console.log('CSS transformから回転角度:', rotation);
          }
        }
      }
    }
  } catch (e) {
    console.warn('CSS変換解析エラー:', e);
  }
  
  // 回転角度の正規化
  rotation = ((rotation % 360) + 360) % 360;
  
  // 回転に応じたスケール計算
  let scaleX, scaleY;
  const is90or270 = (rotation === 90 || rotation === 270);
  
  if (is90or270) {
    // 90度/270度回転時は縦横が入れ替わる
    scaleX = naturalHeight / displayWidth;
    scaleY = naturalWidth / displayHeight;
    console.log('90/270度回転 - スケール計算（縦横入れ替え）');
  } else {
    // 0度/180度回転時は通常通り
    scaleX = naturalWidth / displayWidth;
    scaleY = naturalHeight / displayHeight;
    console.log('0/180度回転 - 通常スケール計算');
  }
  
  // ビューワーオフセット
  const viewerRect = viewerElement ? viewerElement.getBoundingClientRect() : { left: 0, top: 0 };
  const offsetX = displayRect.left - viewerRect.left;
  const offsetY = displayRect.top - viewerRect.top;
  
  const result = {
    naturalWidth,
    naturalHeight,
    displayWidth,
    displayHeight,
    scaleX,
    scaleY,
    rotation,
    offsetX,
    offsetY,
    is90or270,
    // 実際の表示される画像サイズ（回転考慮）
    actualDisplayWidth: is90or270 ? displayHeight : displayWidth,
    actualDisplayHeight: is90or270 ? displayWidth : displayHeight
  };
  
  console.log('最終変換情報:', result);
  console.groupEnd();
  
  return result;
}


/**
 * 回転を正確に考慮した座標変換関数（改良版）
 */
function convertRegionToOriginalImageCoordinates(viewportRegion, transformInfo) {
  const { rotation, is90or270, scaleX, scaleY, offsetX, offsetY } = transformInfo;
  const { naturalWidth, naturalHeight, displayWidth, displayHeight } = transformInfo;
  
  console.group('座標変換詳細');
  console.log('入力領域:', viewportRegion);
  console.log('変換情報:', { rotation, is90or270, scaleX, scaleY });
  
  // ビューポート座標から表示画像内の相対座標に変換
  const relativeRegion = {
    x: viewportRegion.x - offsetX,
    y: viewportRegion.y - offsetY,
    width: viewportRegion.width,
    height: viewportRegion.height
  };
  
  console.log('相対座標:', relativeRegion);
  
  // 表示画像の中心点
  const centerX = displayWidth / 2;
  const centerY = displayHeight / 2;
  
  // 選択領域の中心点（表示画像内）
  const regionCenterX = relativeRegion.x + relativeRegion.width / 2;
  const regionCenterY = relativeRegion.y + relativeRegion.height / 2;
  
  // 中心からの相対位置
  const relativeToCenterX = regionCenterX - centerX;
  const relativeToCenterY = regionCenterY - centerY;
  
  console.log('中心からの相対位置:', { relativeToCenterX, relativeToCenterY });
  
  let originalRegion = {};
  
  // 回転角度に応じた変換
  switch (rotation) {
    case 0:
      // 回転なし
      originalRegion = {
        x: relativeRegion.x * scaleX,
        y: relativeRegion.y * scaleY,
        width: relativeRegion.width * scaleX,
        height: relativeRegion.height * scaleY
      };
      break;
      
    case 90:
      // 90度時計回り回転
      // 元画像の中心から見た座標
      const orig90CenterX = naturalWidth / 2 + relativeToCenterY * scaleX;
      const orig90CenterY = naturalHeight / 2 - relativeToCenterX * scaleY;
      
      originalRegion = {
        x: orig90CenterX - (relativeRegion.height * scaleX) / 2,
        y: orig90CenterY - (relativeRegion.width * scaleY) / 2,
        width: relativeRegion.height * scaleX,
        height: relativeRegion.width * scaleY
      };
      break;
      
    case 180:
      // 180度回転
      const orig180CenterX = naturalWidth / 2 - relativeToCenterX * scaleX;
      const orig180CenterY = naturalHeight / 2 - relativeToCenterY * scaleY;
      
      originalRegion = {
        x: orig180CenterX - (relativeRegion.width * scaleX) / 2,
        y: orig180CenterY - (relativeRegion.height * scaleY) / 2,
        width: relativeRegion.width * scaleX,
        height: relativeRegion.height * scaleY
      };
      break;
      
    case 270:
      // 270度時計回り回転（-90度）
      const orig270CenterX = naturalWidth / 2 - relativeToCenterY * scaleX;
      const orig270CenterY = naturalHeight / 2 + relativeToCenterX * scaleY;
      
      originalRegion = {
        x: orig270CenterX - (relativeRegion.height * scaleX) / 2,
        y: orig270CenterY - (relativeRegion.width * scaleY) / 2,
        width: relativeRegion.height * scaleX,
        height: relativeRegion.width * scaleY
      };
      break;
      
    default:
      // その他の角度（ラジアン計算）
      const angleRad = (rotation * Math.PI) / 180;
      const cos = Math.cos(-angleRad);
      const sin = Math.sin(-angleRad);
      
      // 回転行列による逆変換
      const rotatedX = relativeToCenterX * cos - relativeToCenterY * sin;
      const rotatedY = relativeToCenterX * sin + relativeToCenterY * cos;
      
      const origCenterX = naturalWidth / 2 + rotatedX * scaleX;
      const origCenterY = naturalHeight / 2 + rotatedY * scaleY;
      
      originalRegion = {
        x: origCenterX - (relativeRegion.width * scaleX) / 2,
        y: origCenterY - (relativeRegion.height * scaleY) / 2,
        width: relativeRegion.width * scaleX,
        height: relativeRegion.height * scaleY
      };
  }
  
  // 境界チェックと調整
  originalRegion.x = Math.max(0, Math.min(originalRegion.x, naturalWidth - originalRegion.width));
  originalRegion.y = Math.max(0, Math.min(originalRegion.y, naturalHeight - originalRegion.height));
  originalRegion.width = Math.min(originalRegion.width, naturalWidth - originalRegion.x);
  originalRegion.height = Math.min(originalRegion.height, naturalHeight - originalRegion.y);
  
  // 整数に丸める
  originalRegion.x = Math.round(originalRegion.x);
  originalRegion.y = Math.round(originalRegion.y);
  originalRegion.width = Math.round(originalRegion.width);
  originalRegion.height = Math.round(originalRegion.height);
  
  // メタデータを追加
  originalRegion.rotation = rotation;
  originalRegion.is90or270 = is90or270;
  
  console.log('変換後の元画像座標:', originalRegion);
  console.groupEnd();
  
  return originalRegion;
}


/**
 * 回転を考慮して正確に画像セクションを描画する関数
 * @param {CanvasRenderingContext2D} ctx - キャンバスのコンテキスト
 * @param {HTMLImageElement} img - 画像要素
 * @param {Object} region - 切り出す領域情報
 * @param {Object} transformInfo - 変換情報
 * @returns {boolean} 描画が成功したかどうか
 */
function drawRotatedImageSection(ctx, img, region, transformInfo) {
  const canvas = ctx.canvas;
  
  try {
    console.group('画像描画処理');
    console.log('描画領域:', region);
    console.log('回転角度:', region.rotation || transformInfo.rotation);
    
    // キャンバスサイズを設定
    canvas.width = region.width;
    canvas.height = region.height;
    
    // キャンバスをクリア
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 画像が完全に読み込まれているかチェック
    if (!img.complete || img.naturalWidth === 0) {
      throw new Error('画像が完全に読み込まれていません');
    }
    
    // 元画像から指定領域を切り出し（回転は考慮しない - 元画像は既に正しい向き）
    ctx.drawImage(
      img,
      region.x, region.y, region.width, region.height,  // ソース領域
      0, 0, region.width, region.height                 // 描画先領域
    );
    
    console.log('画像描画完了');
    console.groupEnd();
    
    return true;
    
  } catch (error) {
    console.error('画像描画エラー:', error);
    console.groupEnd();
    
    // エラー表示
    ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('画像描画エラー', canvas.width / 2, canvas.height / 2 - 10);
    ctx.fillText(error.message, canvas.width / 2, canvas.height / 2 + 10);
    
    return false;
  }
}
/**
 * 画像全体を処理する関数も同様に改善
 */
function processFullImage() {

  // ===== 追加: ロックチェック =====
  if (!window.globalOcrLock.acquire()) {
    showNotification('OCR処理中です。しばらくお待ちください', 'info');
    return;
  }
  // ===============================

 

  // APIキーをチェック
   chrome.runtime.sendMessage({action: "checkApiKey"}, function(result) {
    if (!result || !result.hasKey || !result.isValid) {
      showNotification('Gemini APIキーが設定されていないか無効です。拡張機能の設定でAPIキーを設定してください。', 'error');
      window.globalOcrLock.release(); // ロック解除を追加
      return;
    }
    // 領域選択モード中なら終了
    endAreaSelection();
    
    // 処理中フラグを設定
    setProcessingFlag(true);
    
    // 処理中通知
    showNotification('OCR処理中...', 'processing');
    // フォーカスされているフィールドがあるか確認
    let fieldType = getFieldTypeFromFocusedElement();
    
    // フィールドタイプが確定していない場合はデフォルトで支払先名を使用
    if (!fieldType) {
      fieldType = 'payee-name';
      // 支払先名フィールドにフォーカス
      focusFieldByType(fieldType);
    }
    
    // 画像を探して処理
    findAndProcessFullImage(fieldType);
  });
}



 /**
 * 画像要素を探して処理する
 */
function findAndProcessImage(fieldType) {
  console.log('画像を検索中...');
  
  // 画像ビューワーを探す（複数のセレクターで試行）
  const viewerSelectors = [
    '#viewer-container .viewer',
    '.viewer-container .viewer',
    '.verfication-image-wrapper',
    '#viewer-container',
    '.viewer-container',
    '.verification-image-container',
    '.verification-content',
    '.image-viewer-container',
    '.receipt-image-container',
    '.content-area:has(img)'
  ];
  
  let viewer = null;
  for (const selector of viewerSelectors) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        viewer = element;
        console.log('ビューワーを発見:', selector);
        break;
      }
    } catch (e) {
      // :has() セレクタなどCSS4セレクタがサポートされていない場合のエラー回避
      console.warn('セレクター検索エラー:', selector, e);
    }
  }
  
  // 画像を直接探す
  const allImages = document.querySelectorAll('img');
  let targetImage = null;
  
  if (allImages && allImages.length > 0) {
    console.log('ページ内に画像を発見:', allImages.length, '個');
    
    // 最大の表示されている画像を選択（おそらく領収書）
    let maxArea = 0;
    
    for (const img of allImages) {
      // 表示されている画像かチェック
      const isVisible = img.offsetParent !== null && 
                       !!(img.offsetWidth || img.offsetHeight || img.getClientRects().length);
      
      if (isVisible) {
        const width = img.clientWidth || img.width || 0;
        const height = img.clientHeight || img.height || 0;
        const area = width * height;
        
        // ある程度のサイズがある場合のみ対象とする
        if (area > maxArea && area > 10000) { // 最低100px×100px以上
          maxArea = area;
          targetImage = img;
          viewer = img.parentElement;
          console.log('最大の画像を発見:', width, 'x', height, '=', area, 'px²');
        }
      }
    }
  }
  
  if (!targetImage && viewer) {
    // ビューワー内の画像を探す
    const imgSelectors = [
      'img', // ビューワー内の任意のimg
      'img.receipt-image', // 領収書画像クラス
      'img.verification-image', // 検証画像クラス
      'img.main-image', // メイン画像クラス
      '.image-container img', // 画像コンテナ内のimg
    ];
    
    for (const selector of imgSelectors) {
      const element = viewer.querySelector(selector);
      if (element) {
        targetImage = element;
        console.log('ビューワー内の画像を発見:', selector);
        break;
      }
    }
  }
  
  if (!targetImage && !viewer) {
    console.error('画像とビューワーが見つかりません');
    showNotification('画像が見つかりません。表示されている領収書画像がない可能性があります。', 'error');
    return;
  }
  
  if (!targetImage) {
    console.error('ビューワー内に画像が見つかりません');
    showNotification('領収書画像が見つかりません', 'error');
    return;
  }
  
  // 見つかった画像をログ出力（デバッグ用）
  console.log('処理する画像:', targetImage);
  console.log('- サイズ:', targetImage.width, 'x', targetImage.height);
  console.log('- 自然サイズ:', targetImage.naturalWidth, 'x', targetImage.naturalHeight);
  console.log('- src:', targetImage.src ? targetImage.src.substring(0, 50) + '...' : 'なし');
  
  // 画像を処理
  processFullImageWithType(targetImage, fieldType);
}


function findAndProcessFullImage(fieldType) {
  const targetImage = findImageElement();
  
  if (!targetImage) {
    showNotification('画像が見つかりません', 'error');
    setProcessingFlag(false);
    window.globalOcrLock.release();
    return;
  }
  
  if (!isValidImage(targetImage)) {
    showNotification('画像が無効または読み込まれていません。ページを再読み込みしてください。', 'error');
    setProcessingFlag(false);
    window.globalOcrLock.release();
    return;
  }


  const viewer = findViewerElement();
  
  try {
    // 改良された変換情報取得
    const transformInfo = getImageTransformInfo(targetImage, viewer);
    console.log('全体画像変換情報:', transformInfo);
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // 元画像のサイズでキャンバスを設定（回転は考慮しない）
    canvas.width = transformInfo.naturalWidth;
    canvas.height = transformInfo.naturalHeight;
    
    // 元画像をそのまま描画（回転情報はメタデータとして保持）
    ctx.drawImage(
      targetImage,
      0, 0, transformInfo.naturalWidth, transformInfo.naturalHeight
    );
    
    const imageData = canvas.toDataURL('image/jpeg', 0.95);
    
    // プレビュー表示
    showAreaPreview(imageData, null, transformInfo);
    
    // APIに送信（回転情報も含める）
    chrome.runtime.sendMessage({
      action: "streamedDockOcr",
      imageData: imageData,
      field: fieldType,
      rotation: transformInfo.rotation,
      is90or270: transformInfo.is90or270,
      originalDimensions: {
        width: transformInfo.naturalWidth,
        height: transformInfo.naturalHeight
      }
    }, response => {
      if (chrome.runtime.lastError) {
        console.error('メッセージ送信エラー:', chrome.runtime.lastError);
        showNotification('OCR処理のリクエストに失敗しました', 'error');
        updatePreviewStatus('OCR処理に失敗しました', 'error');
        setProcessingFlag(false);
        window.globalOcrLock.release();
      }
    });
    
  } catch (error) {
    console.error('全体画像処理エラー:', error);
    showNotification('画像の処理に失敗しました: ' + error.message, 'error');
    setProcessingFlag(false);
    window.globalOcrLock.release();
  }
}
/**
 * ビューワー要素を探す関数
 * @returns {HTMLElement|null} 見つかったビューワー要素
 */
function findViewerElement() {
  const viewerSelectors = [
    '#viewer-container',
    '.viewer-container',
    '.verfication-image-wrapper',
    '.verification-image-container',
    '.verification-content',
    '.image-viewer-container',
    '.receipt-image-container'
  ];
  
  for (const selector of viewerSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element;
    }
  }
  
  return null;
}
/**
 * 画像要素を探す関数
 * @returns {HTMLImageElement|null} 見つかった画像要素
 */
function findImageElement() {
  // 画像ビューワーを探す（複数のセレクターで試行）
  const viewerSelectors = [
    '#viewer-container .viewer',
    '.viewer-container .viewer',
    '.verfication-image-wrapper',
    '#viewer-container',
    '.viewer-container',
    '.verification-image-container',
    '.verification-content',
    '.image-viewer-container',
    '.receipt-image-container',
    '.content-area:has(img)'
  ];
  
  let viewer = null;
  for (const selector of viewerSelectors) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        viewer = element;
        console.log('ビューワーを発見:', selector);
        break;
      }
    } catch (e) {
      console.warn('セレクター検索エラー:', selector, e);
    }
  }
  
  // 画像を探す
  if (viewer) {
    // ビューワー内の画像を探す
    const imgSelectors = [
      'img', // ビューワー内の任意のimg
      'img.receipt-image', // 領収書画像クラス
      'img.verification-image', // 検証画像クラス
      'img.main-image', // メイン画像クラス
      '.image-container img', // 画像コンテナ内のimg
    ];
    
    for (const selector of imgSelectors) {
      const element = viewer.querySelector(selector);
      if (element && isValidImage(element)) {
        return element;
      }
    }
  }
  
  // ページ内のすべての画像を調査
  const allImages = document.querySelectorAll('img');
  let largestImage = null;
  let maxArea = 0;
  
  for (const img of allImages) {
    // 表示されている画像かチェック
    if (!isValidImage(img)) continue; 
    const isVisible = img.offsetParent !== null && 
                     !!(img.offsetWidth || img.offsetHeight || img.getClientRects().length);
    
    if (isVisible) {
      const width = img.clientWidth || img.width || 0;
      const height = img.clientHeight || img.height || 0;
      const area = width * height;
      
      // ある程度のサイズがある場合のみ対象とする
      if (area > maxArea && area > 10000) {
        maxArea = area;
        largestImage = img;
      }
    }
  }
  
  return largestImage;
}


function isValidImage(img) {
  if (!img || img.tagName !== 'IMG') {
    return false;
  }
  
  // 画像が読み込まれているかチェック
  if (!img.complete) {
    return false;
  }
  
  // 自然サイズがあるかチェック
  const naturalWidth = img.naturalWidth || 0;
  const naturalHeight = img.naturalHeight || 0;
  
  if (naturalWidth === 0 || naturalHeight === 0) {
    console.log('画像の自然サイズが無効:', naturalWidth, 'x', naturalHeight);
    return false;
  }
  
  // 最小サイズチェック（10x10ピクセル未満は無効）
  if (naturalWidth < 10 || naturalHeight < 10) {
    console.log('画像が小さすぎます:', naturalWidth, 'x', naturalHeight);
    return false;
  }
  
  // srcがdata:やblob:の場合は有効、http(s):の場合はエラーチェック
  const src = img.src || '';
  if (src.startsWith('http') && img.naturalWidth === 0) {
    console.log('HTTP画像の読み込みが失敗している可能性');
    return false;
  }
  
  return true;
}



 /**
 * 指定したフィールドタイプで画像全体を処理
 * @param {HTMLImageElement} imgElement - 画像要素
 * @param {string} fieldType - フィールドタイプ
 */
function processFullImageWithType(imgElement, fieldType) {
  // 画像オブジェクトのチェック
  if (!imgElement) {
    console.error('画像要素がnullまたは未定義です');
    showNotification('有効な画像が見つかりません', 'error');
    return;
  }

  if (typeof imgElement !== 'object') {
    console.error('画像要素がオブジェクトではありません：', typeof imgElement);
    showNotification('有効な画像が見つかりません', 'error');
    return;
  }

  if (!imgElement.tagName || imgElement.tagName.toLowerCase() !== 'img') {
    console.error('画像要素が<img>タグではありません：', imgElement.tagName);
    showNotification('有効な画像が見つかりません', 'error');
    return;
  }
  
  showNotification('OCR処理中...', 'processing');
  
  try {
    // 画像が完全に読み込まれたことを確認
    if (!imgElement.complete) {
      console.log('画像の読み込みが完了していません、読み込み完了を待機します');
      
      // 画像が読み込まれるまで待機
      imgElement.onload = function() {
        console.log('画像の読み込みが完了しました、処理を続行します');
        processLoadedImage(imgElement, fieldType);
      };
      
      // 画像読み込みエラー時の処理
      imgElement.onerror = function() {
        console.error('画像の読み込み中にエラーが発生しました');
        showNotification('画像の読み込みに失敗しました', 'error');
      };
      
      // 既に読み込み済みの場合、onloadイベントは発火しないため、手動チェック
      if (imgElement.complete) {
        console.log('画像は既に読み込まれています、処理を続行します');
        processLoadedImage(imgElement, fieldType);
      }
    } else {
      // 既に読み込まれている場合は直接処理
      processLoadedImage(imgElement, fieldType);
    }
  } catch (error) {
    console.error('画像処理エラー:', error);
    showNotification('画像の処理に失敗しました: ' + error.message, 'error');
  }
}


/**
 * 読み込み完了した画像を処理する
 * @param {HTMLImageElement} imgElement - 読み込み済み画像要素
 * @param {string} fieldType - フィールドタイプ
 */
function processLoadedImage(imgElement, fieldType) {
  try {
    // 画像の実際のサイズを取得（0の場合はエラー）
    const imgWidth = imgElement.naturalWidth || imgElement.width;
    const imgHeight = imgElement.naturalHeight || imgElement.height;
    
    console.log('画像サイズ:', imgWidth, 'x', imgHeight);
    
    if (imgWidth <= 0 || imgHeight <= 0) {
      throw new Error('画像サイズが無効です（' + imgWidth + 'x' + imgHeight + '）');
    }
    
    // Canvas を作成
    const canvas = document.createElement('canvas');
    canvas.width = imgWidth;
    canvas.height = imgHeight;
    
    // 2Dコンテキストを取得
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2Dコンテキストを取得できませんでした');
    }
    
    // クロスオリジン問題を回避するための設定
    imgElement.crossOrigin = 'Anonymous';
    
    // 画像を描画
    try {
      ctx.drawImage(imgElement, 0, 0, imgWidth, imgHeight);
    } catch (drawError) {
      console.error('Canvas描画エラー:', drawError);
      // クロスオリジンエラーの可能性があるので、別の方法を試す
      showNotification('画像を処理できません。セキュリティ制限のためCORSエラーが発生した可能性があります。', 'error');
      return;
    }
    
    // 画像データを取得
    try {
      const imageData = canvas.toDataURL('image/jpeg', 0.98);
      
      // データURLの形式チェック
      if (!imageData || !imageData.startsWith('data:image/')) {
        throw new Error('無効な画像データ形式です');
      }
      
      // Gemini APIを使用してOCR処理
      chrome.runtime.sendMessage({
        action: "streamedDockOcr",
        imageData: imageData,
        field: fieldType,
        options: { field: fieldType }
      }, response => {
        if (chrome.runtime.lastError) {
          console.error('メッセージ送信エラー:', chrome.runtime.lastError);
          showNotification('OCR処理のリクエストに失敗しました', 'error');
        }
      });
    } catch (dataUrlError) {
      console.error('toDataURL エラー:', dataUrlError);
      
      // セキュリティエラーの可能性がある場合の特別メッセージ
      if (dataUrlError.name === 'SecurityError' || 
          dataUrlError.message.includes('tainted') || 
          dataUrlError.message.includes('security')) {
        showNotification('セキュリティ制限のため画像を処理できません。別の方法で試してください。', 'error');
      } else {
        showNotification('画像データの変換に失敗しました: ' + dataUrlError.message, 'error');
      }
    }
  } catch (error) {
    console.error('画像処理エラー:', error);
    showNotification('画像の処理に失敗しました: ' + error.message, 'error');
  }
}

/**
 * OCR結果を処理する関数 - 複数候補の処理を統一
 * @param {string} text - 認識されたテキスト
 * @param {string} fieldType - フィールドタイプ
 */
function handleOcrResult(text, fieldType) {
  if (!text) return;
  console.log(`handleOcrResult called with: ${fieldType}, text: ${text}`); 
  
  // 電話番号フィールドの処理
  if (fieldType === 'phone-number') {
    // カンマ区切りの複数候補があるかチェック
    if (text.includes(',') || text.includes('、')) {
      console.log('複数の電話番号を検出:', text);
      
      // カンマで分割して処理
      const phoneNumbers = text.split(/[,、]/)
        .map(num => num.trim().replace(/[^\d\-]/g, ''))
        .filter(num => num.length > 0);
      
      console.log('処理後の電話番号候補:', phoneNumbers);
      
      // 有効な電話番号のみをフィルタリング
      const validPhoneNumbers = phoneNumbers.filter(num => {
        // ハイフンと数字以外の文字を削除
        const digitsOnly = num.replace(/[^\d]/g, '');
        // 日本の電話番号は通常9〜12桁
        return digitsOnly.length <= 12 && digitsOnly.length >= 7;
      });
      
      if (validPhoneNumbers.length === 0) {
        console.log('有効な電話番号が見つかりませんでした');
        showNotification('有効な電話番号が認識できませんでした', 'error');
        return;
      }
      
      // 重複を排除して一意の電話番号を取得
      const uniquePhoneNumbers = [...new Set(validPhoneNumbers)];
      
      // 複数の一意な電話番号がある場合はドロップダウンを表示
      if (uniquePhoneNumbers.length > 1) {
        console.log('複数の一意な電話番号を検出:', uniquePhoneNumbers);
        showPhoneNumberDropdown(uniquePhoneNumbers);
        return; // 重要: 処理を終了
      }
      
      // 一意な電話番号が1つだけの場合は直接入力
      fillTextField(uniquePhoneNumbers[0], fieldType);
      return;
    } else {
      // 単一の電話番号の場合
      const cleanedNumber = text.trim().replace(/[^\d\-]/g, '');
      const digitsOnly = cleanedNumber.replace(/[^\d]/g, '');
      
      // 電話番号として有効かチェック
      if (digitsOnly.length > 12 || digitsOnly.length < 9) {
        console.log('無効な電話番号:', cleanedNumber);
        showNotification('有効な電話番号ではありません', 'error');
        return;
      }
      
      // 有効な電話番号ならフィールドに入力
      fillTextField(cleanedNumber, fieldType);
    }
  } 
  // 支払先名フィールドの処理
  else if (fieldType === 'payee-name') {
     // カンマ区切りの複数候補があるかチェック - 正確なチェック
    if (text && (text.includes(',') || text.includes('、'))) {
      console.log('複数の支払先名を検出:', text);
      
      try {
        // カンマで分割して処理
        const payeeNames = text.split(/[,、]/)
          .map(name => name.trim())
          .filter(name => name.length > 0);
        
        console.log('処理後の支払先名候補:', payeeNames);
        
        // 重複を排除して一意の支払先名を取得
        const uniquePayeeNames = [...new Set(payeeNames)];
        
        // 複数の一意な支払先名がある場合はドロップダウンを表示
        if (uniquePayeeNames.length > 1) {
          console.log('複数の一意な支払先名を検出:', uniquePayeeNames);
          showPayeeNameDropdown(uniquePayeeNames);
          return; // 重要: 処理を終了して自動入力しない
        }
        
        // 一意な支払先名が1つだけの場合は直接入力
        if (uniquePayeeNames.length === 1) {
          fillTextField(uniquePayeeNames[0], fieldType);
          return;
        }
      } catch (e) {
        console.error('支払先名の候補処理でエラー:', e);
      }
    }
    
    // 単一の支払先名の場合またはエラー発生時は、そのまま入力
    fillTextField(text.trim(), fieldType);
  
  }
  // その他のフィールドタイプ（ふりがななど）の処理
  else {
    fillTextField(text.trim(), fieldType);
  }
}




/**
 * 電話番号の有効性をチェック（元の桁数制限を維持）
 * @param {string} phoneNumber - チェックする電話番号
 * @returns {boolean} - 有効な電話番号かどうか
 */
function isValidPhoneNumber(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return false;
  }
  
  // 数字のみを抽出
  const digitsOnly = phoneNumber.replace(/[^\d]/g, '');
  
  // 元の桁数チェック（7桁から11桁まで）
  if (digitsOnly.length < 7 || digitsOnly.length > 11) {
    return false;
  }
  
  // Tで始まる13桁の事業者番号は除外
  if (digitsOnly.length === 13 && phoneNumber.toUpperCase().includes('T')) {
    return false;
  }
  
  return true;
}




/**
 * 共通のドロップダウン表示関数（履歴対応版）
 */
function showDropdown(options) {
  const { id, title, items, targetField, formatter, onSelect } = options;
  
  // 既存のドロップダウンをチェック
  const existingDropdown = document.getElementById(id);
  if (existingDropdown) existingDropdown.remove();
  
  // フィールドにフォーカス
  targetField.focus();
  
  // フィールドタイプに基づいてチェックボックスを特定
  let checkbox;
  if (id === 'phone-number-dropdown') {
    checkbox = document.getElementById('checkbox-add-key-tel');
  } else if (id === 'payee-name-dropdown') {
    checkbox = document.getElementById('checkbox-add-key-name');
  } else {
    // フォールバック: 検索ボタンの位置を使用
    let searchButton;
    if (id === 'phone-number-dropdown') {
      searchButton = document.querySelector('[data-search-tel]');
    } else if (id === 'payee-name-dropdown') {
      searchButton = document.querySelector('[data-search-name]');
    } else if (id === 'phonetic-dropdown') {
      searchButton = document.querySelector('[data-search-kana]');
    }
    
    if (searchButton) {
      // 検索ボタンが見つかった場合は、その位置情報を使用
      const buttonRect = searchButton.getBoundingClientRect();
      checkbox = { getBoundingClientRect: () => ({ right: buttonRect.right + 30, top: buttonRect.top }) };
    } else {
      // フォールバック: 入力フィールドの位置情報を使用
      const fieldRect = targetField.getBoundingClientRect();
      checkbox = { getBoundingClientRect: () => ({ right: fieldRect.right + 30, top: fieldRect.top }) };
    }
  }
  
  // ドロップダウンコンテナの作成
  const dropdownContainer = document.createElement('div');
  dropdownContainer.id = id;
  dropdownContainer.className = 'ocr-dropdown-container ocr-bubble-dropdown';
  
  // 履歴ドロップダウンの場合のクラス追加
  if (id === 'payee-history-dropdown') {
    dropdownContainer.classList.add('payee-history-dropdown');
  }
  
  // 基本のz-indexを設定
  const baseZIndex = 100000;
  
  // チェックボックスの位置情報を取得
  const checkboxRect = checkbox ? checkbox.getBoundingClientRect() : 
                     targetField.getBoundingClientRect();
  // 入力フィールドの高さ情報を取得
  const inputFieldRect = targetField.getBoundingClientRect();

  // バブルスタイルの設定
  dropdownContainer.style.cssText = `
    position: absolute;
    z-index: ${baseZIndex};
    background-color: white;
    border: 1px solid #ddd;
    border-radius: 8px;
    box-shadow: 0 3px 10px rgba(0,0,0,0.3);
    max-height: 230px;
    max-width: 300px;
    width: auto;
    left: ${checkboxRect.right + 10}px;
    top: ${inputFieldRect.top}px;
    overflow: visible;
    font-family: sans-serif;
    font-size: 14px;
    transition: box-shadow 0.2s ease;
  `;
  
// 履歴ドロップダウンの場合は位置調整
if (id === 'payee-history-dropdown') {
  // デフォルト位置は通常の支払先名ドロップダウンと同じX位置
  let baseLeft = checkboxRect.right + 10;
  let baseTop = inputFieldRect.top;
  
  // OCRドロップダウンが存在する場合はその右側に移動
  const ocrDropdown = document.getElementById('payee-name-dropdown');
  if (ocrDropdown) {
    const ocrRect = ocrDropdown.getBoundingClientRect();
    baseLeft = ocrRect.right + 20; // OCRドロップダウンの右側20px
    baseTop = ocrRect.top; // 同じY位置
  }
  
  dropdownContainer.style.left = baseLeft + 'px';
  dropdownContainer.style.top = baseTop + 'px';
}
  
  // 左向きの矢印を追加
  const arrow = document.createElement('div');
  arrow.style.cssText = `
    position: absolute;
    left: -10px;
    top: 15px;
    width: 0;
    height: 0;
    border-top: 10px solid transparent;
    border-bottom: 10px solid transparent;
    border-right: 10px solid white;
    filter: drop-shadow(-2px 0px 2px rgba(0,0,0,0.1));
  `;
  dropdownContainer.appendChild(arrow);
  
  // ヘッダー部分
  const header = document.createElement('div');
  const headerBgColor = id === 'payee-history-dropdown' ? '#e6e0f8' : '#1a73e8';
  const headerTextColor = id === 'payee-history-dropdown' ? '#4a3a6b' : 'white';
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    background-color: ${headerBgColor};
    color: white;
    position: relative;
    border-radius: 16px;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 16px;
    border-top-right-radius: 16px;
    border-top-left-radius: 16px;
    margin-right: -8px;
    right: -8px;
  `;
  
  // タイトル部分
  const titleElement = document.createElement('div');
  titleElement.style.cssText = `
    font-weight: 500;
    flex-grow: 1;
    display: flex;
    align-items: center;
  `;
  
  // タイトルテキスト
  const titleText = document.createElement('span');
  titleText.textContent = title;
  titleElement.appendChild(titleText);
  
  // 優先度制御用のハンドルを追加
  const handle = document.createElement('span');
  handle.innerHTML = '&#8942;';
  handle.className = 'ocr-dropdown-handle';
  handle.style.cssText = `
    position: absolute;
    right: -12px;
    top: 50%;
    transform: translateY(-50%);
    width: 24px;
    height: 24px;
    background-color: rgba(255, 255, 255, 0.6);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 14px;
    transition: background-color 0.2s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    z-index: 1;
  `;
  
  // ハンドルのホバーエフェクト
  handle.addEventListener('mouseover', () => {
    handle.style.backgroundColor = 'rgba(255, 255, 255, 0.4)';
  });
  
  handle.addEventListener('mouseout', () => {
    handle.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
  });

  // ハンドルのクリックイベントリスナー
  handle.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const listContainer = dropdownContainer.querySelector('div:last-child');
    const isCollapsed = listContainer.style.display === 'none';
    
    if (isCollapsed) {
      listContainer.style.display = 'block';
      dropdownContainer.style.height = 'auto';
      handle.innerHTML = '&#9650;';
      handle.style.backgroundColor = '#4CAF50';
    } else {
      listContainer.style.display = 'none';
      dropdownContainer.style.height = header.offsetHeight + 'px';
      handle.innerHTML = '&#9660;';
      handle.style.backgroundColor = 'rgba(255, 255, 255, 0.6)';
    }
    
    if (isCollapsed) {
      const allDropdowns = document.querySelectorAll('.ocr-dropdown-container');
      let maxZIndex = 100000;
      allDropdowns.forEach((dropdown) => {
        const zIndex = parseInt(dropdown.style.zIndex || '100000', 10);
        if (!isNaN(zIndex)) {
          maxZIndex = Math.max(maxZIndex, zIndex);
        }
      });
      
      const newZIndex = maxZIndex + 10;
      dropdownContainer.style.zIndex = newZIndex;
      
      allDropdowns.forEach((dropdown) => {
        const dropdownHandle = dropdown.querySelector('.ocr-dropdown-handle');
        if (dropdownHandle && dropdownHandle !== handle) {
          dropdownHandle.style.backgroundColor = 'rgba(255, 255, 255, 0.6)';
        }
      });
    }
    
    const message = isCollapsed ? 'ドロップダウンを展開しました' : 'ドロップダウンを折りたたみました';
    showNotification(message, 'info', 1000);
  });
  
  titleElement.appendChild(handle);
  
  // 閉じるボタン
  const closeButton = document.createElement('span');
  closeButton.innerHTML = '&times;';
  closeButton.style.cssText = `
    cursor: pointer;
    font-size: 20px;
    line-height: 1;
    opacity: 0.8;
    padding: 0 4px;
  `;
  
  closeButton.addEventListener('click', () => {
    dropdownContainer.remove();
  });
  
  closeButton.addEventListener('mouseover', () => {
    closeButton.style.opacity = '1';
  });
  
  closeButton.addEventListener('mouseout', () => {
    closeButton.style.opacity = '0.8';
  });
  
  header.appendChild(titleElement);
  header.appendChild(closeButton);
  dropdownContainer.appendChild(header);
  
  // リスト部分
  const listContainer = document.createElement('div');
  listContainer.style.cssText = `
    max-height: 200px;
    overflow-y: auto;
    transition: all 0.3s ease;
  `;
  
  // 項目を追加
  items.forEach((item, index) => {
    const itemElement = document.createElement('div');
    itemElement.textContent = formatter ? formatter(item) : item;
    itemElement.style.cssText = `
      padding: 8px 12px;
      cursor: pointer;
      border-bottom: ${index < items.length - 1 ? '1px solid #eee' : 'none'};
      transition: background-color 0.15s;
    `;
    
    // 履歴ドロップダウンの場合のスタイル調整
    if (id === 'payee-history-dropdown') {
      itemElement.style.borderLeft = '3px solid #e6e0f8';
      itemElement.style.paddingLeft = '15px';
    }
    
    // ホバーエフェクト
    itemElement.addEventListener('mouseover', () => {
      if (id === 'payee-history-dropdown') {
        itemElement.style.backgroundColor = '#d5c9f0';
        itemElement.style.color = '#4a3a6b';
      } else {
        itemElement.style.backgroundColor = '#f5f5f5';
      }
    });
    itemElement.addEventListener('mouseout', () => {
      itemElement.style.backgroundColor = 'white';
      itemElement.style.color = '';
    });
    
    // クリックイベント
    itemElement.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (onSelect) onSelect(item);
      simulateKeyPress(targetField, 'Enter');
    });
    
    listContainer.appendChild(itemElement);
  });
  
  dropdownContainer.appendChild(listContainer);
  document.body.appendChild(dropdownContainer);
  
  // イベントバブリング防止
  dropdownContainer.addEventListener('click', e => e.stopPropagation());
  
  // ドロップダウンが配置できない場合の自動位置調整
  adjustDropdownPosition(dropdownContainer);
  
  return dropdownContainer;
}

/**
 * キーボードイベントをシミュレートする関数
 * @param {HTMLElement} element - イベント発火対象の要素
 * @param {string} key - キー名（'Enter', 'Tab'など）
 */
function simulateKeyPress(element, key) {
  if (!element) return;
  
  try {
    // フォーカスを確保
    element.focus();
    
    // モダンな KeyboardEvent を使用
    const keyEvent = new KeyboardEvent('keydown', {
      key: key,
      code: key === 'Enter' ? 'Enter' : key === 'Tab' ? 'Tab' : key,
      keyCode: key === 'Enter' ? 13 : key === 'Tab' ? 9 : null,
      which: key === 'Enter' ? 13 : key === 'Tab' ? 9 : null,
      bubbles: true,
      cancelable: true
    });
    
    // イベントを発行
    element.dispatchEvent(keyEvent);
    
    // keyupイベントも発行（完全なキープレスのシミュレーション用）
    const keyUpEvent = new KeyboardEvent('keyup', {
      key: key,
      code: key === 'Enter' ? 'Enter' : key === 'Tab' ? 'Tab' : key,
      keyCode: key === 'Enter' ? 13 : key === 'Tab' ? 9 : null,
      which: key === 'Enter' ? 13 : key === 'Tab' ? 9 : null,
      bubbles: true,
      cancelable: true
    });
    
    element.dispatchEvent(keyUpEvent);
    
    console.log(`${key}キーイベントが発行されました`);
  } catch (error) {
    console.error('キーイベントシミュレーションエラー:', error);
    
    // フォールバック: input/changeイベントのみを発火
    const changeEvent = new Event('change', { bubbles: true });
    element.dispatchEvent(changeEvent);
  }
}




/**
 * 電話番号のドロップダウンリストを表示（修正版）
 * @param {string[]|string} phoneNumbers - 電話番号の配列または文字列
 * @param {string} originalText - デバッグ用の元のテキスト（オプション）
 */
function showPhoneNumberDropdown(phoneNumbers, originalText = '') {
  console.log('電話番号ドロップダウン表示開始:');
  console.log('- phoneNumbers:', phoneNumbers);
  console.log('- phoneNumbers type:', typeof phoneNumbers);
  console.log('- phoneNumbers isArray:', Array.isArray(phoneNumbers));
  if (originalText) console.log('- 元のテキスト:', originalText);
  
  // 1. 入力を正規化して配列に変換する
  let numbersArray = [];
  
  if (Array.isArray(phoneNumbers)) {
    numbersArray = [...phoneNumbers];
  } else if (typeof phoneNumbers === 'string') {
    if (phoneNumbers.includes(',') || phoneNumbers.includes('、') || phoneNumbers.includes(';')) {
      numbersArray = phoneNumbers.split(/[,、;]/);
    } else {
      numbersArray = [phoneNumbers];
    }
  } else if (phoneNumbers) {
    numbersArray = [String(phoneNumbers)];
  }
  
  console.log('処理対象の電話番号候補数:', numbersArray.length);
  
  // 2. より柔軟な電話番号検証を行う
  const validPhoneNumbers = numbersArray
    .map((num, index) => {
      const str = String(num).trim();
      console.log(`候補${index + 1}: "${str}"`);
      
      if (!str) {
        console.log(`- スキップ: 空文字`);
        return null;
      }
      
      // 数字、ハイフン、プラス記号のみを保持
      const cleaned = str.replace(/[^\d\-+()（）\s]/g, '');
      console.log(`- クリーニング後: "${cleaned}"`);
      
      // 全角数字を半角に変換
      const normalized = cleaned.replace(/[０-９]/g, char => 
        String.fromCharCode(char.charCodeAt(0) - 0xFEE0)
      );
      console.log(`- 正規化後: "${normalized}"`);
      
      // 数字を含むかチェック
      const hasDigits = /\d/.test(normalized);
      if (!hasDigits) {
        console.log(`- スキップ: 数字が含まれていない`);
        return null;
      }
      
      // 桁数チェック（元の設定を維持）
      const digitsOnly = normalized.replace(/[^\d]/g, '');
      console.log(`- 数字のみ: "${digitsOnly}" (${digitsOnly.length}桁)`);
      
      // 日本の電話番号は通常7〜11桁
      const validLength = digitsOnly.length >= 7 && digitsOnly.length <= 11;
      
      // Tで始まる13桁の事業者番号は除外
      if (digitsOnly.length === 13 && str.toUpperCase().includes('T')) {
        console.log(`- スキップ: T始まりの13桁事業者番号`);
        return null;
      }
      
      if (!validLength) {
        console.log(`- スキップ: 桁数が不適切 (${digitsOnly.length}桁)`);
        return null;
      }
      
      console.log(`- 有効: "${normalized}"`);
      return normalized;
    })
    .filter(Boolean);
  
  // 3. 有効な電話番号がない場合の改善されたエラー処理
  if (validPhoneNumbers.length === 0) {
   // console.warn('有効な電話番号が見つかりませんでした。詳細:');
   // console.warn('- 元の入力:', phoneNumbers);
    //console.warn('- 元の入力タイプ:', typeof phoneNumbers);
    //console.warn('- 処理された配列:', numbersArray);
    //console.warn('- 元のテキスト:', originalText);
    
    // より詳細なエラーメッセージ（オブジェクト表示を修正）
    let recognizedText = originalText || '';
    if (!recognizedText && phoneNumbers) {
      if (Array.isArray(phoneNumbers)) {
        recognizedText = phoneNumbers.join(', ');
      } else if (typeof phoneNumbers === 'object') {
        // オブジェクトの場合は JSON 文字列化を試行
        try {
          recognizedText = JSON.stringify(phoneNumbers);
        } catch (e) {
          recognizedText = '[複雑なデータ]';
        }
      } else {
        recognizedText = String(phoneNumbers);
      }
    }
    
    const detailedMessage = `電話番号を認識できませんでした。${recognizedText ? `認識されたテキスト: "${recognizedText}"` : ''}別の領域を選択するか、画質を確認してください。`;
    
    showNotification(detailedMessage, 'warning', 5000);
    return false;
  }
  
  // 4. 重複を排除
  const uniquePhoneNumbers = [...new Set(validPhoneNumbers)];
  console.log('フィルタリング後の電話番号:', uniquePhoneNumbers);
  
  // 5. 単一の電話番号の場合は直接入力
  if (uniquePhoneNumbers.length === 1) {
    const phoneField = document.querySelector('[data-input-text="phone-number"]');
    if (phoneField) {
      phoneField.value = uniquePhoneNumbers[0];
      phoneField.dispatchEvent(new Event('input', { bubbles: true }));
      phoneField.dispatchEvent(new Event('change', { bubbles: true }));
      
      showNotification(`電話番号「${uniquePhoneNumbers[0]}」を入力しました`, 'success');
      
      // 検索ボタンを自動クリック
      setTimeout(() => {
        const searchButton = document.querySelector('[data-search-tel]');
        if (searchButton && !searchButton.disabled) searchButton.click();
      }, 300);
      
      return true;
    }
  }
  
  // 6. 電話番号フィールドを取得
  const phoneField = document.querySelector('[data-input-text="phone-number"]');
  if (!phoneField) {
    console.error('電話番号フィールドが見つかりません');
    showNotification('電話番号フィールドが見つかりません', 'error');
    return false;
  }
  
  try {
    console.log('ドロップダウン表示を試行します');
    
    // 7. 既存のドロップダウンを削除（重複防止）
    const existingDropdown = document.getElementById('phone-number-dropdown');
    if (existingDropdown) {
      console.log('既存のドロップダウンを削除します');
      existingDropdown.remove();
    }
    
    // 8. 共通ドロップダウン表示関数を使用
    const dropdown = showDropdown({
      id: 'phone-number-dropdown',
      title: '電話番号を選択',
      items: uniquePhoneNumbers,
      targetField: phoneField,
      formatter: (phone) => {
        // 電話番号のフォーマット関数が利用可能ならそれを使用
        if (typeof formatPhoneNumber === 'function') {
          return formatPhoneNumber(phone);
        }
        return phone;
      },
      onSelect: (phone) => {
        // フィールドに入力
        phoneField.value = phone;
        
        // イベント発火
        phoneField.dispatchEvent(new Event('input', { bubbles: true }));
        phoneField.dispatchEvent(new Event('change', { bubbles: true }));
        
        // 成功通知
        showNotification(`電話番号「${phone}」を入力しました`, 'success');
        
        // 検索ボタンを自動クリック
        setTimeout(() => {
          const searchButton = document.querySelector('[data-search-tel]');
          if (searchButton && !searchButton.disabled) searchButton.click();
        }, 300);
      }
    });
    
    // 9. ドロップダウンが表示されたことを確認
    if (dropdown) {
      console.log('電話番号ドロップダウンが表示されました。要素ID:', dropdown.id || '不明');
      
      // 通知
      showNotification(`${uniquePhoneNumbers.length}件の電話番号候補が見つかりました`, 'info');
      return true;
    } else {
      console.error('電話番号ドロップダウン表示失敗: ドロップダウンが作成されませんでした');
      showNotification('電話番号ドロップダウンの表示に失敗しました', 'error');
      return false;
    }
  } catch (error) {
    console.error('電話番号ドロップダウン表示エラー:', error);
    showNotification('電話番号ドロップダウンの表示に失敗しました: ' + error.message, 'error');
    return false;
  }
}

// 履歴管理クラス
class PayeeNameHistory {
  constructor() {
    this.maxItems = 32;
    this.storageKey = 'payeeNameHistory';
    this.currentSortMode = 'date';
  }

  // 履歴を取得
  async getHistory() {
    try {
      const result = await chrome.storage.local.get([this.storageKey]);
      return result[this.storageKey] || [];
    } catch (error) {
      console.error('履歴取得エラー:', error);
      return [];
    }
  }

  // 履歴に追加
  async addToHistory(payeeName) {
    if (!payeeName || payeeName.trim() === '') return;
    
    try {
      const history = await this.getHistory();
      const trimmedName = payeeName.trim();
      
      // 既存の同じ名前を削除（重複排除）
      const filteredHistory = history.filter(item => item.name !== trimmedName);
      
      // 新しいアイテムを先頭に追加
      const newItem = {
        name: trimmedName,
        timestamp: Date.now(),
        dateAdded: new Date().toLocaleString('ja-JP')
      };
      
      filteredHistory.unshift(newItem);
      
      // 最大件数を超えた分を削除
      if (filteredHistory.length > this.maxItems) {
        filteredHistory.splice(this.maxItems);
      }
      
      // 保存
      await chrome.storage.local.set({ [this.storageKey]: filteredHistory });
      console.log('履歴に追加:', trimmedName);
    } catch (error) {
      console.error('履歴追加エラー:', error);
    }
  }

  // 履歴をクリア
  async clearHistory() {
    try {
      await chrome.storage.local.remove([this.storageKey]);
      console.log('履歴をクリアしました');
    } catch (error) {
      console.error('履歴クリアエラー:', error);
    }
  }

  // ソートモードを切り替え
  toggleSortMode() {
    switch (this.currentSortMode) {
      case 'date':
        this.currentSortMode = 'asc';
        break;
      case 'asc':
        this.currentSortMode = 'desc';
        break;
      case 'desc':
        this.currentSortMode = 'date';
        break;
    }
    console.log('ソートモード変更:', this.currentSortMode);
    return this.currentSortMode;
  }

  // 履歴をソート
  sortHistory(history) {
    const sortedHistory = [...history]; // 元の配列を変更しない
    
    switch (this.currentSortMode) {
      case 'asc':
        return sortedHistory.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      case 'desc':
        return sortedHistory.sort((a, b) => b.name.localeCompare(a.name, 'ja'));
      case 'date':
      default:
        return sortedHistory.sort((a, b) => b.timestamp - a.timestamp);
    }
  }

  // ソートモードの表示名を取得
  getSortModeDisplayName() {
    switch (this.currentSortMode) {
      case 'asc':
        return '履歴から選択 ↑';
      case 'desc':
        return '履歴から選択 ↓';
      case 'date':
      default:
        return '履歴から選択 📅';
    }
  }
}

// グローバルインスタンス
const payeeNameHistory = new PayeeNameHistory();







/**
 * フィールドにテキストを入力する関数（履歴保存機能付き）
 */
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
        .then(() => {
          showNotification('テキストをクリップボードにコピーしました', 'success');
        })
        .catch(err => {
          showNotification('クリップボードへのコピーに失敗しました: ' + err, 'error');
        });
      return true;
  }
  
  if (targetInput) {
    try {
      // フォーカスを設定
      targetInput.focus();
      
      // テキストを入力
      targetInput.value = text.trim();

      // 支払先名の場合、電話番号関連の文字列をチェック
      if (fieldType === 'payee-name') {
        const value = targetInput.value;
        if (value.includes('電話番号') || value.includes('TEL') || 
            value.includes('Tel') || value.includes('電話:') || 
            value.includes('電話：')) {
          console.log('支払先名に電話番号関連の文字列を検出。クリアします:', value);
          targetInput.value = ''; // フィールドをクリア
          showNotification('支払先名に電話番号関連の内容が含まれているためクリアしました', 'warning');
          return false;
        }

      }
      
      // イベント発火
      const inputEvent = new Event('input', { bubbles: true });
      targetInput.dispatchEvent(inputEvent);
      
      const changeEvent = new Event('change', { bubbles: true });
      targetInput.dispatchEvent(changeEvent);
      
      // 認識成功通知
      showNotification(`「${text.trim()}」を認識しました`, 'success');
      // Enterキーを押したようにシミュレート
      simulateKeyPress(targetInput, 'Enter');
      // 検索ボタンの自動クリック
      setTimeout(() => {
        let searchButton = null;
        
        if (fieldType === 'phone-number') {
          searchButton = document.querySelector('[data-search-tel]');
        } else if (fieldType === 'payee-name') {
          searchButton = document.querySelector('[data-search-name]') || 
                         document.querySelector('.btn[data-search-name]') ||
                         document.querySelector('.btn.btn-default.kvs-table-button');
        } else if (fieldType === 'phonetic') {
          searchButton = document.querySelector('[data-search-kana]');
        }

        if (searchButton && !searchButton.disabled) {
          console.log('検索ボタンを自動クリックします:', searchButton);
          searchButton.click();
        }
      }, 150);
      
      return true;
    } catch (err) {
      console.error('フィールド入力エラー:', err);
      showNotification('入力フィールドの更新に失敗しました: ' + err.message, 'error');
      return false;
    }
  } else {
    // ターゲット入力がない場合（クリップボードモード以外）
    showNotification('対象のフィールドが見つかりません', 'error');
    return false;
  }
}



function setupSaveMonitoring() {
  console.log('保存操作の監視を開始します');
  
  // 保存ボタンやフォーム送信を監視
  const saveButtons = [
    '[data-save]',
    '.btn-save',
    '.save-button',
    'button[type="submit"]',
    'input[type="submit"]',
    // STREAMED Dock 固有の保存ボタン
    '.btn-primary',
    '.submit-btn'
  ];
  
  // 各種保存ボタンにクリックイベントリスナーを追加
  saveButtons.forEach(selector => {
    const buttons = document.querySelectorAll(selector);
    buttons.forEach(button => {
      // 重複リスナーを避けるため、一度削除してから追加
      button.removeEventListener('click', handleSaveClick);
      button.addEventListener('click', handleSaveClick);
    });
  });
  
  // フォーム送信も監視
  const forms = document.querySelectorAll('form');
  forms.forEach(form => {
    form.removeEventListener('submit', handleFormSubmit);
    form.addEventListener('submit', handleFormSubmit);
  });
  
  // MutationObserver で動的に追加されるボタンも監視
  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      mutation.addedNodes.forEach(function(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // 新しく追加されたボタンにもリスナーを設定
          saveButtons.forEach(selector => {
            if (node.matches && node.matches(selector)) {
              node.addEventListener('click', handleSaveClick);
            }
            // 子要素もチェック
            const childButtons = node.querySelectorAll && node.querySelectorAll(selector);
            if (childButtons) {
              childButtons.forEach(btn => btn.addEventListener('click', handleSaveClick));
            }
          });
        }
      });
    });
  });
  
  observer.observe(document.body, { childList: true, subtree: true });
  window.ocrResourceManager.register('observer', observer);
}

function handleSaveClick(event) {
  console.log('保存ボタンがクリックされました:', event.target);
  
  // 少し遅延させて、保存処理が完了してから履歴に追加
  setTimeout(() => {
    checkAndSaveToHistory();
  }, 500); // 0.5秒後にチェック
}

function handleFormSubmit(event) {
  console.log('フォームが送信されました:', event.target);
  
  // フォーム送信後に履歴に追加
  setTimeout(() => {
    checkAndSaveToHistory();
  }, 300); // 0.3秒後にチェック
}

function checkAndSaveToHistory() {
  // 支払先名フィールドの値を取得
  const payeeField = document.querySelector('[data-input-text="payee-name"]');
  if (!payeeField) return;
  
  const payeeName = payeeField.value.trim();
  if (!payeeName) return;
  
  // 有効な支払先名かチェック（電話番号関連の文字列を除外）
  if (payeeName.includes('電話番号') || payeeName.includes('TEL') || 
      payeeName.includes('Tel') || payeeName.includes('電話:') || 
      payeeName.includes('電話：')) {
    console.log('電話番号関連の文字列のため履歴に追加しません:', payeeName);
    return;
  }
  
  // 保存の成功を示すUI要素があるかチェック（オプション）
  const successIndicators = [
    '.success-message',
    '.alert-success',
    '.notification.success',
    '.toast.success'
  ];
  
  let saveSuccess = false;
  for (const selector of successIndicators) {
    const element = document.querySelector(selector);
    if (element && element.offsetParent !== null) {
      saveSuccess = true;
      break;
    }
  }
  
  // 成功インジケーターがない場合でも、エラーがなければ保存成功と判断
  const errorIndicators = [
    '.error-message',
    '.alert-error',
    '.notification.error',
    '.toast.error'
  ];
  
  let hasErrors = false;
  for (const selector of errorIndicators) {
    const element = document.querySelector(selector);
    if (element && element.offsetParent !== null) {
      hasErrors = true;
      break;
    }
  }
  
  // エラーがない場合は保存成功と判断
  if (!hasErrors) {
    console.log('保存が完了したため履歴に追加します:', payeeName);
    payeeNameHistory.addToHistory(payeeName);
    
    // 保存完了の通知（オプション）
    showNotification(`「${payeeName}」を履歴に追加しました`, 'info', 2000);
  } else {
    console.log('エラーが検出されたため履歴に追加しません');
  }
}

function setupSpaceKeyListener() {
  // 支払先名フィールドにダブルクリックイベントを設定
  const payeeField = document.querySelector('[data-input-text="payee-name"]');
  if (payeeField) {
// 支払先名フィールドにホイールイベントを設定
payeeField.removeEventListener('wheel', handlePayeeFieldWheel);
payeeField.addEventListener('wheel', handlePayeeFieldWheel);
  }
}

// ホイールハンドラー
function handlePayeeFieldWheel(e) {
  // フィールドにフォーカスがある場合のみ処理
  if (document.activeElement === e.target) {
    e.preventDefault();
    e.stopPropagation();
    console.log('支払先名フィールドホイール回転検出');
    showPayeeHistoryDropdown();
  }
}




async function showPayeeHistoryDropdown() {
  const payeeField = document.querySelector('[data-input-text="payee-name"]');
  if (!payeeField) {
    showNotification('支払先名フィールドが見つかりません', 'error');
    return;
  }
  
  const rawHistory = await payeeNameHistory.getHistory();
  
  if (!rawHistory || rawHistory.length === 0) {
    showNotification('履歴がありません', 'info', 2000);
    return;
  }
  
  const sortedHistory = payeeNameHistory.sortHistory(rawHistory);
  // 履歴名前リストを作成 - 変数名を修正
  const historyNames = sortedHistory.map(item => item.name);  // ← 修正：正しい変数名
  const title = payeeNameHistory.getSortModeDisplayName();


  
 
  
  // 既存のshowDropdown関数を使用（UIの一貫性を保つため）
  const dropdown = showDropdown({
    id: 'payee-history-dropdown',
    title: title, // 変更
    items: historyNames,
    targetField: payeeField,
    onSelect: (name) => {
      // フィールドに入力
      payeeField.value = name;
      
      // イベント発火
      payeeField.dispatchEvent(new Event('input', { bubbles: true }));
      payeeField.dispatchEvent(new Event('change', { bubbles: true }));
      
      // 成功通知
      showNotification(`履歴から「${name}」を選択しました`, 'success');
      
      // 検索ボタンを自動クリック
      setTimeout(() => {
        const searchButton = document.querySelector('[data-search-name]') || 
                            document.querySelector('.btn[data-search-name]') ||
                            document.querySelector('.btn.btn-default.kvs-table-button');
        if (searchButton && !searchButton.disabled) searchButton.click();
      }, 300);
      
      // ドロップダウンを閉じる
      //const dropdown = document.getElementById('payee-history-dropdown');
      //if (dropdown) dropdown.remove();
    }
  });
  
  // 履歴ドロップダウン専用のスタイルを適用
  if (dropdown) {
    // ヘッダー色を変更
    const header = dropdown.querySelector('.ocr-preview-header, div:first-child');
    if (header && header.style) {
      header.style.backgroundColor = '#e6e0f8'; // 淡いすみれ色
      header.style.color = '#4a3a6b';
    }
       // タイトル部分にクリックイベントを追加
    const titleElement = dropdown.querySelector('div:first-child span');
    if (titleElement) {
      titleElement.style.cursor = 'pointer';
      titleElement.style.userSelect = 'none';
      titleElement.title = 'クリックでソート切替: 日付新順 → 昇順 → 降順';
      
      titleElement.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        // ソートモードを切り替え
        const newMode = payeeNameHistory.toggleSortMode();
        
      // タイトルテキストを即座に更新 ← 追加
        titleElement.textContent = payeeNameHistory.getSortModeDisplayName();
        
        // リスト部分のみを更新（ちらつき防止） ← 追加
        updateHistoryDropdownList(dropdown, rawHistory);
        
        // ソート変更通知
        let modeText = '';
        switch (newMode) {
          case 'asc': modeText = '昇順（あ→ん）'; break;
          case 'desc': modeText = '降順（ん→あ）'; break;
          case 'date': modeText = '日付新順'; break;
        }
        showNotification(`ソート変更: ${modeText}`, 'info', 1500);
      });
    }
    // 位置調整：OCRドロップダウンより右側に配置
    const ocrDropdown = document.getElementById('payee-name-dropdown');
    //if (ocrDropdown) {
      //const ocrRect = ocrDropdown.getBoundingClientRect();
      //dropdown.style.left = (ocrRect.right + 20) + 'px'; // OCRドロップダウンの右側20px
      //dropdown.style.top = ocrRect.top + 'px'; // 同じY位置
    //} else {
      // OCRドロップダウンがない場合は通常の位置
      const payeeRect = payeeField.getBoundingClientRect();
      dropdown.style.left = (payeeRect.right + 20) + 'px';
      dropdown.style.top = payeeRect.top + 'px';
    //}
    
    // 履歴ドロップダウンの識別用クラスを追加
    dropdown.classList.add('payee-history-dropdown');
  }
  
  // 通知表示
  showNotification(`${rawHistory.length}件の履歴が見つかりました`, 'info', 2000);


}

/**
 * 履歴ドロップダウンのリスト部分のみを更新する関数（ちらつき防止）
 * @param {HTMLElement} dropdown - ドロップダウン要素
 * @param {Array} rawHistory - 元の履歴データ
 */
function updateHistoryDropdownList(dropdown, rawHistory) {
  // 既存のリストコンテナを取得
  const listContainer = dropdown.querySelector('div:last-child');
  if (!listContainer) return;
  
  // 新しいソート順で履歴を取得
  const sortedHistory = payeeNameHistory.sortHistory(rawHistory);
  const historyNames = sortedHistory.map(item => item.name);
  
  // リストコンテナをクリア
  listContainer.innerHTML = '';
  
  // 支払先名フィールドを取得
  const payeeField = document.querySelector('[data-input-text="payee-name"]');
  
  // 新しいリスト項目を追加
  historyNames.forEach((name, index) => {
    const itemElement = document.createElement('div');
    itemElement.textContent = name;
    itemElement.style.cssText = `
      padding: 8px 12px;
      cursor: pointer;
      border-bottom: ${index < historyNames.length - 1 ? '1px solid #eee' : 'none'};
      transition: background-color 0.15s;
      border-left: 3px solid #e6e0f8;
      padding-left: 15px;
    `;
    
    // ホバーエフェクト
    itemElement.addEventListener('mouseover', () => {
      itemElement.style.backgroundColor = '#d5c9f0';
      itemElement.style.color = '#4a3a6b';
    });
    itemElement.addEventListener('mouseout', () => {
      itemElement.style.backgroundColor = 'white';
      itemElement.style.color = '';
    });
    
    // クリックイベント
    itemElement.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (payeeField) {
        // フィールドに入力
        payeeField.value = name;
        
        // イベント発火
        payeeField.dispatchEvent(new Event('input', { bubbles: true }));
        payeeField.dispatchEvent(new Event('change', { bubbles: true }));
        
        // 成功通知
        showNotification(`履歴から「${name}」を選択しました`, 'success');
        
        // 履歴に再追加（最新に移動）
        payeeNameHistory.addToHistory(name);
        
        // 検索ボタンを自動クリック
        setTimeout(() => {
          const searchButton = document.querySelector('[data-search-name]') || 
                              document.querySelector('.btn[data-search-name]') ||
                              document.querySelector('.btn.btn-default.kvs-table-button');
          if (searchButton && !searchButton.disabled) searchButton.click();
        }, 300);
        
        // ドロップダウンを閉じる
        dropdown.remove();
      }
      
      simulateKeyPress(payeeField, 'Enter');
    });
    
    listContainer.appendChild(itemElement);
  });
}




/**
 * 支払先名ドロップダウンを表示する関数
 * @param {string[]} payeeNames - 支払先名の配列
 */
function showPayeeNameDropdown(payeeNames) {
  // 有効な支払先名のみをフィルタリング（空文字以外）
  const validPayeeNames = payeeNames
    .map(name => name.trim())
    .filter(name => name.length > 0)
    .map(name => {
      // 半角変換を適用
      return name.replace(/[Ａ-Ｚａ-ｚ０-９・]/g, function(s) {
        if (s === '・') return '･';
        return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
      });
    });

  
  if (validPayeeNames.length === 0) {
    showNotification('有効な支払先名が認識できませんでした', 'error');
    return;
  }
  
  // 重複を排除
  const uniquePayeeNames = [...new Set(validPayeeNames)];
  
  // 一意の支払先名が1つだけの場合、直接入力
  if (uniquePayeeNames.length === 1) {
    fillTextField(uniquePayeeNames[0], 'payee-name');
    return;
  }
  
  // 支払先名フィールドを取得
  const payeeField = document.querySelector('[data-input-text="payee-name"]');
  if (!payeeField) {
    showNotification('支払先名フィールドが見つかりません', 'error');
    return;
  }
  
  // フィールドをクリア
  payeeField.value = '';
  
  // 共通ドロップダウン表示関数を使用
  showDropdown({
    id: 'payee-name-dropdown',
    title: '支払先名を選択',
    items: uniquePayeeNames,
    targetField: payeeField,
    onSelect: (name) => {
      // フィールドに入力
      payeeField.value = name;
      
      // イベント発火
      payeeField.dispatchEvent(new Event('input', { bubbles: true }));
      payeeField.dispatchEvent(new Event('change', { bubbles: true }));
      
      // 成功通知
      showNotification(`「${name}」を選択しました`, 'success');
      
      // 検索ボタンを自動クリック
      setTimeout(() => {
        const searchButton = document.querySelector('[data-search-name]') || 
                            document.querySelector('.btn[data-search-name]') ||
                            document.querySelector('.btn.btn-default.kvs-table-button');
        if (searchButton && !searchButton.disabled) searchButton.click();
      }, 300);
    }
  });
  
  // 通知
  showNotification('複数の支払先名が認識されました', 'info');
}


/**
 * ドロップダウンの位置を自動調整する関数
 * @param {HTMLElement} dropdown - ドロップダウン要素
 */
function adjustDropdownPosition(dropdown) {
  // ビューポートサイズを取得
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  // 現在の位置とサイズを取得
  const rect = dropdown.getBoundingClientRect();
  
  // 右側の余白をチェック（右にはみ出す場合）
  if (rect.right > viewportWidth - 20) {
    // 左側に表示する
    const arrow = dropdown.querySelector('div:first-child'); // 最初の子要素（矢印）
    if (arrow) {
      // 矢印の位置を右側に移動
      arrow.style.left = 'auto';
      arrow.style.right = '-10px';
      arrow.style.borderRight = 'none';
      arrow.style.borderLeft = '10px solid white';
    }
    
    // 検索ボタンの左側に配置
    const newLeft = rect.left - dropdown.offsetWidth - 30; // 30pxはマージン
    dropdown.style.left = `${Math.max(10, newLeft)}px`;
  }
  
  // 下側の余白をチェック（下にはみ出す場合）
  if (rect.bottom > viewportHeight - 20) {
    // 上方向に移動
    const newTop = viewportHeight - dropdown.offsetHeight - 20;
    dropdown.style.top = `${Math.max(10, newTop)}px`;
  }
}

// 既存のドロップダウン表示関数を拡張して位置調整を追加
const originalShowPhoneNumberDropdown = showPhoneNumberDropdown;
window.showPhoneNumberDropdown = function(...args) {
  const result = originalShowPhoneNumberDropdown.apply(this, args);
  adjustDropdownPositions();
  return result;
};

const originalShowPayeeNameDropdown = showPayeeNameDropdown;
window.showPayeeNameDropdown = function(...args) {
  const result = originalShowPayeeNameDropdown.apply(this, args);
  adjustDropdownPositions();
  return result;
};


/**
 * DOM要素を再利用する最適化された通知マネージャー
 */
class NotificationManager {
  constructor() {
    this.notifications = {};
    this.timeouts = {};
  }
  
  /**
   * 通知を表示
   * @param {string} message - 表示するメッセージ
   * @param {string} type - 通知タイプ (success, error, warning, info, processing)
   * @param {number} duration - 通知表示時間 (ms)、0の場合は永続表示
   */
  show(message, type = 'info', duration = 3000) {
    // 同じタイプの既存通知があれば再利用
    let notification = this.notifications[type];
    
    if (!notification) {
      // 新しい通知要素を作成
      notification = document.createElement('div');
      notification.className = `ocr-notification ${type}`;
      
      // 基本スタイルを設定
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
        opacity: 0;
        transition: opacity 0.3s ease;
      `;
      
      // タイプ別のスタイル適用
      switch(type) {
        case 'error':
          notification.style.backgroundColor = 'rgba(220, 53, 69, 0.9)';
          notification.style.color = 'white';
          break;
        case 'success':
          notification.style.backgroundColor = 'rgba(40, 167, 69, 0.9)';
          notification.style.color = 'white';
          break;
        case 'processing':
          notification.style.backgroundColor = 'rgba(0, 123, 255, 0.9)';
          notification.style.color = 'white';
          break;
        case 'warning':
          notification.style.backgroundColor = 'rgba(255, 193, 7, 0.9)';
          notification.style.color = 'black';
          break;
        default: // info
          notification.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
          notification.style.color = 'white';
      }
      
      // 再利用のために保存
      this.notifications[type] = notification;
      document.body.appendChild(notification);
    }
    
    // メッセージを更新
    notification.textContent = message;
    
    // トランジション効果のために少し遅延して表示
    setTimeout(() => {
      notification.style.opacity = '1';
    }, 10);
    
    // 既存のタイムアウトをクリア
    if (this.timeouts[type]) {
      clearTimeout(this.timeouts[type]);
      this.timeouts[type] = null;
    }
    
    // 自動非表示のための新しいタイムアウト（エラーと処理中通知以外）
    if (duration > 0 && type !== 'error' && type !== 'processing') {
      this.timeouts[type] = setTimeout(() => {
        this.hide(type);
      }, duration);
    }
    
    return notification;
  }
  
  /**
   * タイプ別に通知を非表示にする
   */
  hide(type) {
    const notification = this.notifications[type];
    if (notification) {
      notification.style.opacity = '0';
      
      // トランジション後にDOMから削除
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
        this.notifications[type] = null;
      }, 300); // トランジション時間に合わせる
    }
    
    // タイムアウトをクリア
    if (this.timeouts[type]) {
      clearTimeout(this.timeouts[type]);
      this.timeouts[type] = null;
    }
  }
  
  /**
   * すべての通知を非表示にする
   */
  hideAll() {
    Object.keys(this.notifications).forEach(type => {
      this.hide(type);
    });
  }
}
// グローバル通知マネージャーの作成
const notificationManager = new NotificationManager();

function showNotification(message, type = 'info', duration = 2000) {
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
  type === 'warning' ? 'rgba(255, 152, 0, 0.9)' :
  'rgba(0, 0, 0, 0.7)'
};
color: white;
  `;
  
  document.body.appendChild(notification);
  
  // 成功通知時に処理フラグを解除（APIが応答した証拠なので）
  if (type === 'success') {
    // APIが正常に応答した証拠なので、処理フラグを解除
    if (typeof STATE !== 'undefined' && STATE.isProcessing) {
      console.log('成功通知に基づいて処理フラグを解除');
      setProcessingFlag(false);
    }
  }
  
  // 自動非表示
if (duration && type !== 'processing') {
  const actualDuration = type === 'error' ? 3000 : duration; // エラーは10秒固定
  setTimeout(() => {
    if (document.body.contains(notification)) {
      document.body.removeChild(notification);
    }
  }, actualDuration);
}
  return notification;
}


/**
 * プレビュー表示を強化した関数
 * @param {string} imageData - 画像データURL
 * @param {Object} region - 切り出し領域情報 (オプション)
 * @param {Object} transformInfo - 変換情報 (オプション)
 * @returns {Object} プレビュー要素
 */
function showAreaPreview(imageData, region = null, transformInfo = null) {
  // 既存のプレビューを削除
  const existingPreview = document.getElementById('ocr-area-preview-container');
  if (existingPreview) {
    document.body.removeChild(existingPreview);
  }
  
  // プレビューコンテナを作成
  const previewContainer = document.createElement('div');
  previewContainer.id = 'ocr-area-preview-container';
  previewContainer.className = 'ocr-area-preview-container';
  
  // ヘッダーを作成
  const previewHeader = document.createElement('div');
  previewHeader.className = 'ocr-preview-header';
  previewHeader.textContent = 'OCR選択領域';
  
  // コントロールコンテナを作成
  const controlsContainer = document.createElement('div');
  controlsContainer.className = 'ocr-preview-controls';
  
  // 閉じるボタンを作成
  const closeButton = document.createElement('span');
  closeButton.className = 'ocr-preview-close';
  closeButton.textContent = '✕';
  closeButton.onclick = function() {
    document.body.removeChild(previewContainer);
  };
  
  // コントロールを組み立て
  controlsContainer.appendChild(closeButton);
  previewHeader.appendChild(controlsContainer);
  
  // 画像プレビューを作成
  const previewImage = document.createElement('img');
  previewImage.className = 'ocr-preview-image';
  previewImage.src = imageData;
  
  // 座標情報を表示（デバッグ用）
  if (region) {
    const coordInfo = document.createElement('div');
    coordInfo.className = 'ocr-preview-coords';
    coordInfo.style.fontSize = '10px';
    coordInfo.style.padding = '3px 8px';
    coordInfo.style.fontFamily = 'monospace';
    coordInfo.style.backgroundColor = '#f8f9fa';
    coordInfo.style.color = '#333';
    coordInfo.style.borderTop = '1px solid #ddd';
    
    let rotationText = '';
    if (transformInfo && transformInfo.rotation !== undefined) {
      rotationText = `, 回転: ${Math.round(transformInfo.rotation)}°`;
    }
    
    coordInfo.textContent = `領域: x=${Math.round(region.x)}, y=${Math.round(region.y)}, ` +
                           `幅: ${Math.round(region.width)}, 高さ: ${Math.round(region.height)}${rotationText}`;
    previewContainer.appendChild(coordInfo);
  }
  
  // ステータスバーを作成
  const statusBar = document.createElement('div');
  statusBar.className = 'ocr-preview-status';
  statusBar.textContent = 'OCR処理中...';
  
  // プレビューコンテナを組み立て
  previewContainer.appendChild(previewHeader);
  previewContainer.appendChild(previewImage);
  previewContainer.appendChild(statusBar);
  
  // ドキュメントに追加
  document.body.appendChild(previewContainer);
  
  // ドラッグ可能に
  makeDraggable(previewContainer, previewHeader);
  
  return { container: previewContainer, image: previewImage, statusBar: statusBar };
}


/**
 * ドラッグ可能な要素を作成する補助関数
 * @param {HTMLElement} element - ドラッグ可能にする要素
 * @param {HTMLElement} handle - ドラッグのハンドル要素（ヘッダーなど）
 */
function makeDraggable(element, handle) {
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  
  if (handle) {
    // ハンドルがある場合はそれをドラッグ用に使用
    handle.style.cursor = 'move';
    handle.onmousedown = dragMouseDown;
  } else {
    // それ以外は要素全体を使用
    element.onmousedown = dragMouseDown;
  }
  
  function dragMouseDown(e) {
    e.preventDefault();
    // 開始時のカーソル位置を取得
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    document.onmousemove = elementDrag;
  }
  
  function elementDrag(e) {
    e.preventDefault();
    // 新しい位置を計算
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    
    // 画面外にはみ出さないように制限
    let newTop = element.offsetTop - pos2;
    let newLeft = element.offsetLeft - pos1;
    
    // 画面の境界をチェック
    const maxX = window.innerWidth - element.offsetWidth;
    const maxY = window.innerHeight - element.offsetHeight;
    
    // 範囲内に収める
    newTop = Math.max(0, Math.min(maxY, newTop));
    newLeft = Math.max(0, Math.min(maxX, newLeft));
    
    // 要素の新しい位置を設定
    element.style.top = newTop + "px";
    element.style.left = newLeft + "px";
  }
  
  function closeDragElement() {
    // マウスボタンが離されたら移動を停止
    document.onmouseup = null;
    document.onmousemove = null;
  }
}

/**
 * OCR処理結果でプレビューのステータスを更新（修正版）
 * @param {string} status - 表示するステータステキスト
 * @param {string} type - ステータスタイプ（success/error/info）
 */
function updatePreviewStatus(status, type = 'info') {
  const preview = document.getElementById('ocr-area-preview-container');
  if (!preview) return;
  
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




/**
 * 統一された画像領域処理関数
 * @param {Object} region - 選択した領域情報
 * @param {string} fieldType - フィールドタイプ
 */
function processImageRegion(region, fieldType) {
  const img = findImageElement();
  if (!img) {
    showNotification('画像が見つかりません', 'error');
    setProcessingFlag(false);
    endAreaSelection();
    return;
  }

  const viewer = findViewerElement() || img.parentElement;
  
  try {
    // 改良された変換情報取得
    const transformInfo = getImageTransformInfo(img, viewer);
    console.log('領域選択変換情報:', transformInfo);
    
    // 改良された座標変換
    const originalRegion = convertRegionToOriginalImageCoordinates(region, transformInfo);
    console.log('変換後の選択領域:', originalRegion);
    
    // 改良された画像描画
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    const success = drawRotatedImageSection(ctx, img, originalRegion, transformInfo);
    if (!success) {
      throw new Error('画像の描画に失敗しました');
    }
    
    const imageData = canvas.toDataURL('image/jpeg', 0.95);
    
    // プレビュー表示
    showAreaPreview(imageData, originalRegion, transformInfo);
    
    // 選択モード終了
    endAreaSelection();

    // APIリクエスト（詳細な回転情報を含む）
    chrome.runtime.sendMessage({
      action: "streamedDockOcr",
      imageData: imageData,
      field: fieldType,
      region: originalRegion,
      rotation: transformInfo.rotation,
      is90or270: transformInfo.is90or270,
      originalDimensions: {
        width: transformInfo.naturalWidth,
        height: transformInfo.naturalHeight
      },
      regionInfo: {
        originalX: originalRegion.x,
        originalY: originalRegion.y,
        originalWidth: originalRegion.width,
        originalHeight: originalRegion.height
      }
    }, response => {
      if (chrome.runtime.lastError) {
        console.error('メッセージ送信エラー:', chrome.runtime.lastError);
        showNotification('OCR処理のリクエストに失敗しました', 'error');
        updatePreviewStatus('OCR処理に失敗しました', 'error');
        setProcessingFlag(false);
      }
    });
    
  } catch (error) {
    console.error('領域選択画像処理エラー:', error);
    showNotification('画像の処理に失敗しました: ' + error.message, 'error');
    setProcessingFlag(false);
    endAreaSelection();
  }
}








  // Chrome拡張機能からのメッセージ受信ハンドラ

// メッセージリスナー - 統一された処理
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === "fillTextField") {

    console.log('OCR処理完了: テキスト入力結果受信');

    const processingNotifications = document.querySelectorAll('.ocr-notification.processing');
    processingNotifications.forEach(notification => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    });


    window.globalOcrLock.release(); 
    STATE.ocrProcessingComplete = true; // OCR完了フラグを設定
    setProcessingFlag(false); // 処理フラグを解除

    const fieldType = request.field || '';
    const text = request.text || '';
    
    console.log(`Received fillTextField: field=${fieldType}, text=${text}`);
    
    // プレビューのステータス更新
    if (typeof updatePreviewStatus === 'function') {
      updatePreviewStatus(`「${text}」を認識しました`, 'success');
    }
    
    // OCR結果の統一処理
    handleOcrResult(text, fieldType);
    
    // 処理完了レスポンス
    sendResponse({success: true});
    return true;
  } 
  // 処理中表示のリクエスト
  else if (request.action === "showProcessing") {
    showNotification(request.message || 'OCR処理中...', 'processing');
    sendResponse({success: true});
    return false; // 同期レスポンス
  } 
  // 処理中通知を非表示にするリクエスト
  else if (request.action === "hideProcessing") {

    console.log('OCR処理完了: 処理中通知非表示リクエスト受信');

    const processingNotifications = document.querySelectorAll('.ocr-notification.processing');
    processingNotifications.forEach(notification => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    });


    window.globalOcrLock.release();

    STATE.ocrProcessingComplete = true; // OCR完了フラグを設定
    setProcessingFlag(false); // 処理フラグを解除


    // NotificationManagerを使用している場合
    if (typeof notificationManager !== 'undefined' && notificationManager.hide) {
      notificationManager.hide('processing');
    } else {
      // DOM直接操作のフォールバック
      const processingNotifications = document.querySelectorAll('.ocr-notification.processing');
      processingNotifications.forEach(notification => {
        if (document.body.contains(notification)) {
          document.body.removeChild(notification);
        }
      });
    }
    sendResponse({success: true});
    return false; // 同期レスポンス
  }else if (request.action === "streamedDockPhoneDropdown") {

    console.log('OCR処理完了: ドロップダウン表示リクエスト受信');

    const processingNotifications = document.querySelectorAll('.ocr-notification.processing');
    processingNotifications.forEach(notification => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    });


    setProcessingFlag(false); // 処理フラグを解除

    console.log('電話番号ドロップダウン表示リクエスト:');
    console.log('- phoneNumbers:', request.phoneNumbers);
    console.log('- originalText:', request.originalText || '（なし）');
    
    // 電話番号ドロップダウンを表示
    const success = showPhoneNumberDropdown(request.phoneNumbers, request.originalText);
    
    // レスポンスを返す
    sendResponse({success: success});
    return true; // 非同期処理のためtrue
  }
  // 支払先名ドロップダウン表示リクエスト - 複数候補がある場合
  else if (request.action === "showPayeeNameDropdown") {
    console.log('OCR処理完了: 支払先名ドロップダウン表示リクエスト受信');

    const processingNotifications = document.querySelectorAll('.ocr-notification.processing');
    processingNotifications.forEach(notification => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    });


    setProcessingFlag(false); // 処理フラグを解除
    
    console.log('支払先名ドロップダウン表示リクエスト:');
    console.log('- payeeNames:', request.payeeNames);
    
    // 支払先名ドロップダウンを表示
    if (typeof showPayeeNameDropdown === 'function') {
      showPayeeNameDropdown(request.payeeNames);
    }
    
    // レスポンスを返す
    sendResponse({success: true});
    return true; // 非同期処理のためtrue
  }
  // エラー表示のリクエスト
  else if (request.action === "showError") {

    console.log('OCR処理完了（エラー）: エラー表示リクエスト受信');

    const processingNotifications = document.querySelectorAll('.ocr-notification.processing');
    processingNotifications.forEach(notification => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    });


    window.globalOcrLock.release();

    setProcessingFlag(false); // 処理フラグを解除

    showNotification(request.error || 'OCR処理に失敗しました', 'error');
    
    if (typeof updatePreviewStatus === 'function') {
      updatePreviewStatus(`エラー: ${request.error}`, 'error');
    }
    
    sendResponse({success: true});
    return false; // 同期レスポンス
  }else if (request.action === "clearErrorNotifications") {
    // エラー通知をすべてクリア
    const errorNotifications = document.querySelectorAll('.ocr-notification.ocr-notification-error');
    errorNotifications.forEach(notification => {
      if (document.body.contains(notification)) {
        document.body.removeChild(notification);
      }
    });
    
    // プレビューのエラー状態もクリア
    const preview = document.getElementById('ocr-area-preview-container');
    if (preview) {
      const statusBar = preview.querySelector('.ocr-preview-status');
      if (statusBar) {
        statusBar.textContent = 'OCR処理中...';
        statusBar.className = 'ocr-preview-status'; // エラークラスを削除
      }
    }
    
    sendResponse({status: "cleared"});
  }



// フォーカス復元処理の追加
  if (request.action === "restoreFocus") {
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
        
        // 現在のフォーカスフィールドを更新
        window.currentFocusField = targetInput;
        
        console.log(`フォーカスを${field}フィールドに復元しました`);
      }, 100);
    }
    
    sendResponse({success: true});
    return true;
  }
  // デフォルトレスポンス
  sendResponse({success: false, error: '不明なアクション'});
  return false;
});



  // ページ読み込み完了時に初期化を実行
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    // 少し遅延させて実行（DOMが完全に構築された後）
    setTimeout(() => {
      initialize();
      // オートモード変更監視を開始
      setTimeout(() => {
        watchAutoModeChanges();
      }, 100);
    }, 100);
  } else {
    window.addEventListener('load', function() {
      // 少し遅延させて実行
      setTimeout(() => {
        initialize();
        // オートモード変更監視を開始
        setTimeout(() => {
          watchAutoModeChanges();
        }, 100);
      }, 100);
    });
  }
window.addEventListener('error', function(event) {
  // 通信エラーなどの重大なエラーが発生した場合
  console.error('グローバルエラー:', event.error);
  
  // 処理中の場合はフラグを解除
  if (typeof STATE !== 'undefined' && STATE.isProcessing) {
    console.log('グローバルエラー発生時に処理フラグを解除');
    setProcessingFlag(false);
  }
});


window.addEventListener('beforeunload', function() {
  // ページが閉じられる前に処理フラグを解除
  if (typeof STATE !== 'undefined' && STATE.isProcessing) {
    console.log('ページ終了時に処理フラグを解除');
    setProcessingFlag(false);
  }
});

window.addEventListener('visibilitychange', function() {
  // タブがバックグラウンドに移動したときに処理フラグを解除
  if (document.visibilityState === 'hidden' && typeof STATE !== 'undefined' && STATE.isProcessing) {
    console.log('タブがバックグラウンドに移動したため処理フラグを解除');
    setProcessingFlag(false);
  }
});




  // DOMの変更を監視して動的に追加された要素に対応
  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      if (mutation.addedNodes.length > 0) {
        // viewer-container要素が追加されたかチェック
        if (!document.querySelector('.ocr-button-group') && 
            (document.querySelector('#viewer-container') || 
             document.querySelector('.viewer-container') ||
             document.querySelector('.verfication-image-wrapper'))) {
          console.log('画像ビューワーを検出、OCRボタンを追加します');
          initialize();
        }
      }
    });
  });
  window.ocrResourceManager.register('observer', observer);
  // DOM変更の監視を開始
  observer.observe(document.body, { childList: true, subtree: true });
})();