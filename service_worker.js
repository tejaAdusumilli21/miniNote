chrome.action.onClicked.addListener(async () => {
  await chrome.windows.create({
    url: chrome.runtime.getURL("newtab.html"),
    type: "popup",
    width: 1280,
    height: 800,
    focused: true
  });
});
