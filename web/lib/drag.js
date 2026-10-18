// 下から出るシートを、下へスワイプして閉じる(iPhone / Android のシートと同じ手ざわり)。
// シートの中を読み進めているあいだは邪魔しないよう、いちばん上までスクロールしてあるときだけ下に引ける。
// 4 分の 1 以上下げるか、勢いよく払ったら閉じる。足りなければ元の位置に戻す。

const SLIDE = "transform .2s ease-out";

// シートを下へ滑らせてから close を呼ぶ(後ろの暗いところのタップでも同じ動きにする)
export function slideDown(sheet, backdrop, close) {
  sheet.style.transition = SLIDE;
  sheet.style.transform = "translateY(100%)";
  backdrop.style.transition = "opacity .2s";
  backdrop.style.opacity = "0";
  setTimeout(close, 180);
}

export function dragToClose(sheet, backdrop, close) {
  let y0 = null, dy = 0, dragging = false, trail = []; // trail: 最近の [時刻, 位置](払った速さを測る)
  sheet.addEventListener("touchstart", (e) => {
    y0 = e.touches[0].clientY;
    dy = 0;
    dragging = false;
    trail = [];
  }, { passive: true });
  sheet.addEventListener("touchmove", (e) => {
    if (y0 == null) return;
    const d = e.touches[0].clientY - y0;
    if (!dragging) {
      // 下向きで、中身がいちばん上にあるときだけ引き始める。それ以外はふつうのスクロールに任せる
      if (d > 6 && sheet.scrollTop <= 0) dragging = true;
      else if (Math.abs(d) > 6) { y0 = null; return; }
      else return;
    }
    e.preventDefault(); // 中身がゴムのように伸びるのを止め、シートだけを動かす
    dy = Math.max(0, d);
    const now = performance.now();
    trail = [...trail.filter(([t]) => now - t < 100), [now, dy]];
    sheet.style.transition = "none";
    sheet.style.transform = `translateY(${dy}px)`;
    backdrop.style.opacity = String(1 - Math.min(1, dy / sheet.offsetHeight));
  }, { passive: false });
  const end = () => {
    if (!dragging) { y0 = null; return; }
    // 離す直前 0.1 秒の速さで見る(ゆっくり触り始めてから払っても閉じるように)。1 ミリ秒に 0.5px より速ければ閉じる
    const [first, last] = [trail[0], trail[trail.length - 1]];
    const fast = first && last && last[0] > first[0] && (last[1] - first[1]) / (last[0] - first[0]) > 0.5;
    if (dy > sheet.offsetHeight * 0.25 || fast) slideDown(sheet, backdrop, close);
    else {
      sheet.style.transition = SLIDE;
      sheet.style.transform = "";
      backdrop.style.opacity = "";
    }
    y0 = null;
    dragging = false;
  };
  sheet.addEventListener("touchend", end);
  sheet.addEventListener("touchcancel", end);
}
