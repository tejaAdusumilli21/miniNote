const Draw = (() => {
  let canvas, ctx;
  let enabled = false;

  let tool = "pen"; // pen | highlighter | eraser
  let color = "#111111";
  let width = 4;

  let drawing = false;
  let last = null;

  function setup(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext("2d");

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    window.addEventListener("resize", resize);
    resize();

    canvas.addEventListener("pointerdown", (e) => {
      if (!enabled) return;
      drawing = true;
      last = { x: e.offsetX, y: e.offsetY };
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener("pointermove", (e) => {
      if (!enabled || !drawing || !last) return;

      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (tool === "eraser") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = "rgba(0,0,0,1)";
        ctx.lineWidth = Math.max(10, width * 2);
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.globalAlpha = tool === "highlighter" ? 0.25 : 1;
      }

      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(e.offsetX, e.offsetY);
      ctx.stroke();

      last = { x: e.offsetX, y: e.offsetY };
      ctx.globalAlpha = 1;
    });

    const end = () => { drawing = false; last = null; };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
  }

  function setEnabled(on) {
    enabled = on;
    canvas.parentElement.style.pointerEvents = on ? "auto" : "none";
    canvas.style.pointerEvents = on ? "auto" : "none";
  }

  function setTool(t) { tool = t; }
  function setColor(c) { color = c; }
  function setWidth(w) { width = Number(w) || 4; }

  function clear() {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function toDataUrl() {
    return canvas.toDataURL("image/png");
  }

  async function loadDataUrl(dataUrl) {
    clear();
    if (!dataUrl) return;
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    ctx.drawImage(img, 0, 0, canvas.getBoundingClientRect().width, canvas.getBoundingClientRect().height);
  }

  return { setup, setEnabled, setTool, setColor, setWidth, clear, toDataUrl, loadDataUrl };
})();
