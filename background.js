// Background Service Worker
// 탭 화면을 캡처해서 content script로 전달합니다
//
// captureVisibleTab은 "activeTab" 제스처(툴바 아이콘 클릭 등) 없이도
// 해당 탭 URL에 대한 host_permissions가 있으면 호출 가능합니다.
// PNG에는 quality 옵션이 적용되지 않으며, 일부 환경에서 오류를 유발할 수 있어 생략합니다.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== "capture_tab") return;

  const tab = sender.tab;
  if (!tab?.windowId) {
    sendResponse({ error: "탭 정보를 확인할 수 없습니다. EasyEDA 페이지를 새로고침한 뒤 다시 시도해주세요." });
    return;
  }

  chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }, (dataUrl) => {
    if (chrome.runtime.lastError) {
      sendResponse({ error: chrome.runtime.lastError.message });
      return;
    }
    if (!dataUrl) {
      sendResponse({ error: "캡처 결과가 비어 있습니다." });
      return;
    }
    sendResponse({ dataUrl });
  });

  return true;
});
