// popup.js — API 키 저장 (local 우선 + sync 보조)

const input = document.getElementById("api-key-input");
const saveBtn = document.getElementById("save-btn");
const statusMsg = document.getElementById("status-msg");
const toggleVis = document.getElementById("toggle-vis");
const connDot = document.getElementById("conn-dot");
const connText = document.getElementById("conn-text");

function normalizeKey(raw) {
  return String(raw || "")
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, "")
    .trim();
}

/** 화면 열 때: 이 기기 local → 동기화 sync 순으로 불러오기 */
chrome.storage.local.get(["openai_api_key"], (loc) => {
  const err = chrome.runtime.lastError;
  if (err) console.warn("[PCB_Agent popup] storage.local:", err.message);

  chrome.storage.sync.get(["openai_api_key"], (sync) => {
    const key = normalizeKey(loc.openai_api_key || sync.openai_api_key);
    if (key) {
      input.value = key;
      setConnected(true);
    }
  });
});

let visible = false;
toggleVis.addEventListener("click", () => {
  visible = !visible;
  input.type = visible ? "text" : "password";
  toggleVis.textContent = visible ? "🙈" : "👁";
});

saveBtn.addEventListener("click", () => {
  const key = normalizeKey(input.value);

  if (!key) {
    showStatus("API 키를 입력해주세요", "error");
    return;
  }

  if (!key.startsWith("sk-")) {
    showStatus("OpenAI 키는 보통 sk- 로 시작합니다. 붙여넣기 오류인지 확인해 주세요.", "error");
    return;
  }

  saveBtn.disabled = true;
  showStatus("저장 중…", "success");

  // 1) 반드시 성공해야 하는 저장: chrome.storage.local
  chrome.storage.local.set({ openai_api_key: key }, () => {
    const errLocal = chrome.runtime.lastError;
    if (errLocal) {
      saveBtn.disabled = false;
      showStatus("저장 실패(로컬): " + errLocal.message, "error");
      return;
    }

    saveBtn.disabled = false;
    setConnected(true);
    showStatus(
      "✅ 저장되었습니다! EasyEDA 탭이 있으면 새로고침(F5) 후 패널에서 사용하세요.",
      "success"
    );

    // 2) 동기화는 비차단(느리거나 실패해도 이미 local 로 사용 가능)
    chrome.storage.sync.set({ openai_api_key: key }, () => {
      if (chrome.runtime.lastError) {
        console.warn("[PCB_Agent] sync 백업 실패:", chrome.runtime.lastError.message);
      }
    });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs
          .sendMessage(tabs[0].id, { action: "api_key_updated", key })
          .catch(() => {});
      }
    });

    setTimeout(() => {
      try {
        window.close();
      } catch (_) {
        showStatus(
          "저장 완료. 팝업은 수동으로 닫아도 됩니다.",
          "success"
        );
      }
    }, 1400);
  });
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveBtn.click();
});

function showStatus(msg, type = "success") {
  statusMsg.textContent = msg;
  statusMsg.className = "status-msg" + (type === "error" ? " error" : "");
  if (type !== "error") {
    setTimeout(() => {
      if (statusMsg.textContent === msg) {
        statusMsg.textContent = "";
        statusMsg.className = "status-msg";
      }
    }, 8000);
  }
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
