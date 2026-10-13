/* 音效：全部用 WebAudio 现场合成，不用音频文件（占位，以后换成正式音效）。 */
(function (G) {
  'use strict';
  const X = G.Sfx = { on: true, vol: 0.5 };
  let ac = null, master = null, noiseBuf = null, hum = null;
  X.unlock = function () {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    master = ac.createGain(); master.gain.value = X.vol; master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  };
  const now = () => ac.currentTime;
  function env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
  function tone(type, f0, f1, dur, peak = 0.3, delay = 0) {
    if (!ac || !X.on) return; const t = now() + delay, o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur); env(g, t, 0.005, peak, dur); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, peak, f0, f1, q = 1, type = 'lowpass', delay = 0) {
    if (!ac || !X.on) return; const t = now() + delay, s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = noiseBuf; fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur); env(g, t, 0.004, peak, dur); s.connect(fl); fl.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.05);
  }
  const last = {};
  const rate = (k, ms) => { const n = performance.now(); if (last[k] && n - last[k] < ms) return false; last[k] = n; return true; };
  X.play = function (name, o = {}) {
    if (!ac || !X.on) return;
    const pt = o.pitch || 1;
    switch (name) {
      /* 就地开打的横版战斗 */
      case 'boom2': noise(0.9, 0.7, 1000, 30); tone('sine', 80, 24, 0.8, 0.55); noise(0.5, 0.25, 3000, 400, 1, 'bandpass', 0.12); break; // 旗舰炸了
      case 'pop': if (rate('pop', 60)) { noise(0.14, 0.32, 5000, 700, 1, 'highpass'); tone('square', 320, 70, 0.14, 0.07); } break; // 气囊破了
      case 'ping': if (rate('ping', 45)) tone('square', 1900 * pt, 1300 * pt, 0.035, 0.035); break; // 子弹打在铁皮上
      case 'eshoot': if (rate('eshoot', 70)) { noise(0.09, 0.12, 900, 180); tone('square', 180, 90, 0.06, 0.04); } break;
      case 'whoosh': noise(0.55, 0.22, 300, 2600, 1.5, 'bandpass'); break;
      case 'whooshDown': noise(0.6, 0.22, 2600, 260, 1.5, 'bandpass'); break;
      case 'charge': tone('sawtooth', 120, 520, 0.5, 0.06); break; // 旗舰蓄力
      case 'cutin': [523, 784, 1046].forEach((f, i) => tone('triangle', f, f, 0.35, 0.13, i * 0.05)); noise(0.4, 0.2, 600, 5000, 1, 'bandpass'); break;
      case 'shell': if (rate('shell', 90)) tone('triangle', 3400, 2900, 0.04, 0.025); break; // 弹壳落地
      case 'full': [880, 1175, 1568].forEach((f, i) => tone('triangle', f, f, 0.18, 0.12, i * 0.06)); break; // 技能充满
      case 'poof': if (rate('poof', 80)) noise(0.3, 0.1, 1400, 260); break; // 掉进云海
      case 'snap': tone('square', 700, 260, 0.08, 0.06); noise(0.1, 0.12, 2500, 800, 2, 'bandpass'); break; // 甲板绳子崩断
      case 'thud': tone('sine', 120, 45, 0.35, 0.5); noise(0.25, 0.25, 500, 80); break; // 速度档掉一档：船身一沉，一声闷响
      case 'shoot': if (rate('shoot', 55)) { tone('square', 900, 500, 0.05, 0.05); } break;
      case 'ehit': if (rate('ehit', 40)) noise(0.06, 0.12, 3000, 800, 1, 'bandpass'); break;
      case 'hit': noise(0.3, 0.5, 2000, 100); tone('sawtooth', 200, 60, 0.25, 0.2); break;
      case 'boom': noise(0.6, 0.55, 1200, 40); tone('sine', 90, 30, 0.5, 0.4); break;
      case 'coin': tone('triangle', 1320, 1320, 0.08, 0.18); tone('triangle', 1760, 1760, 0.18, 0.18, 0.07); break;
      case 'tip': tone('triangle', 1568, 1568, 0.08, 0.16); tone('triangle', 2093, 2093, 0.2, 0.16, 0.06); tone('triangle', 2637, 2637, 0.25, 0.12, 0.13); break;
      case 'bell': [1, 2.76, 5.4].forEach((m, i) => tone('sine', 660 * m, 660 * m, 1.6 - i * 0.4, 0.25 / (i + 1))); break;
      case 'pick': tone('square', 520, 880, 0.09, 0.08); break;
      case 'catch': tone('square', 660 * pt, 1320 * pt, 0.1, 0.1); tone('triangle', 1320 * pt, 1320 * pt, 0.12, 0.08, 0.05); break; // pitch：连着接，一箱比一箱高
      case 'throw': noise(0.35, 0.25, 400, 2500, 2, 'bandpass'); break;
      case 'lost': noise(0.5, 0.15, 1500, 200, 1, 'bandpass'); break;
      case 'alarm': tone('square', 440, 440, 0.12, 0.12); tone('square', 330, 330, 0.18, 0.12, 0.14); break;
      case 'click': tone('square', 1200, 900, 0.03, 0.05); break;
      case 'deny': tone('square', 200, 150, 0.12, 0.08); break;
      case 'install': noise(0.08, 0.2, 2500, 600, 2, 'bandpass'); tone('triangle', 300, 600, 0.08, 0.12, 0.03); break;
      case 'skill': tone('sawtooth', 200, 1200, 0.4, 0.15); noise(0.5, 0.2, 800, 4000, 1, 'bandpass'); break;
      case 'dash': noise(0.15, 0.18, 600, 3000, 1, 'bandpass'); break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => tone('triangle', f, f, 0.3, 0.15, i * 0.09)); break;
      case 'fanfare': [392, 523, 659, 784, 659, 1046].forEach((f, i) => tone('triangle', f, f, 0.35, 0.16, i * 0.11)); break;
      case 'step': if (rate('step', 120)) noise(0.03, 0.04, 900, 300); break;
      case 'leave': tone('sine', 400, 250, 0.25, 0.08); break;
      case 'graze': if (rate('graze', 70)) tone('sine', 2400, 2600, 0.04, 0.03); break;
    }
  };
  /* 大地图上的引擎低鸣：推重比越低越沉 */
  X.hum = function (on, pitch = 1) {
    if (!ac || !X.on) return;
    if (on && !hum) { const o = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain(), fl = ac.createBiquadFilter(); o.type = 'sawtooth'; o2.type = 'sine'; fl.type = 'lowpass'; fl.frequency.value = 220; g.gain.value = 0.0001; o.connect(fl); o2.connect(fl); fl.connect(g); g.connect(master); o.start(); o2.start(); hum = { o, o2, g }; g.gain.exponentialRampToValueAtTime(0.05, now() + 0.6); }
    if (hum) { hum.o.frequency.setTargetAtTime(48 * pitch, now(), 0.3); hum.o2.frequency.setTargetAtTime(72 * pitch, now(), 0.3); }
    if (!on && hum) { const h = hum; hum = null; h.g.gain.setTargetAtTime(0.0001, now(), 0.15); setTimeout(() => { try { h.o.stop(); h.o2.stop(); } catch (e) { } }, 600); }
  };
})(window.G);
