// popup.js - API 키 설정 관리

const input = document.getElementById("api-key-input");
const saveBtn = document.getElementById("save-btn");
const statusMsg = document.getElementById("status-msg");
const toggleVis = document.getElementById("toggle-vis");
const connDot = document.getElementById("conn-dot");
const connText = document.getElementById("conn-text");

// 저장된 키 불러오기
chrome.storage.sync.get(["openai_api_key"], (result) => {
  if (result.openai_api_key) {
    input.value = result.openai_api_key;
    setConnected(true);
  }
});

// 비밀번호 표시 토글
let visible = false;
toggleVis.addEventListener("click", () => {
  visible = !visible;
  input.type = visible ? "text" : "password";
  toggleVis.textContent = visible ? "🙈" : "👁";
});

// 저장
saveBtn.addEventListener("click", () => {
  const key = input.value.trim();

  if (!key) {
    showStatus("API 키를 입력해주세요", "error");
    return;
  }

  if (!key.startsWith("sk-")) {
    showStatus("올바른 OpenAI API 키 형식이 아닙니다 (sk-로 시작)", "error");
    return;
  }

  chrome.storage.sync.set({ openai_api_key: key }, () => {
    showStatus("✅ 저장되었습니다!");
    setConnected(true);
    // 현재 활성 탭(EasyEDA 등)에 키 업데이트 알림 → content.js가 즉시 반응
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "api_key_updated", key })
          .catch(() => {}); // content script 없는 탭이면 무시
      }
    });
    // 팝업 자동 닫기 (약간의 딜레이로 저장 피드백 표시 후)
    setTimeout(() => window.close(), 900);
  });
});

// Enter 키 지원
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveBtn.click();
});

function showStatus(msg, type = "success") {
  statusMsg.textContent = msg;
  statusMsg.className = "status-msg" + (type === "error" ? " error" : "");
  setTimeout(() => {
    statusMsg.textContent = "";
    statusMsg.className = "status-msg";
  }, 3000);
}

function setConnected(connected) {
  if (connected) {
    connDot.className = "status-dot active";
    connText.textContent = "API 키 설정됨";
  } else {
    connDot.className = "status-dot";
    connText.textContent = "설정 안됨";
  }
}
