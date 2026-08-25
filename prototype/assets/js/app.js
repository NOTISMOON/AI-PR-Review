/* =========================================================
   ReviewForge 动画引擎 (v4 · 防御性重构)
   设计原则：
   1. 任何插件缺失 / 任何模块报错，都不影响页面交互
   2. 侧边栏可见性不依赖 JS 动画（防止卡在隐藏态）
   3. 每个模块独立 try/catch 隔离
   ========================================================= */
(function () {
  'use strict';

  /* ---------- 无动画模式 ---------- */
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  /* ---------- GSAP 缺失：直接退出，页面保持可用 ---------- */
  if (typeof window.gsap === 'undefined') return;

  /* ---------- 防御性插件注册：只注册存在的 ---------- */
  try {
    var plugins = [];
    if (window.ScrollTrigger) plugins.push(ScrollTrigger);
    if (window.SplitText) plugins.push(SplitText);
    if (window.CustomEase) plugins.push(CustomEase);
    if (plugins.length) gsap.registerPlugin.apply(gsap, plugins);
    try { CustomEase.create('forge', '0.22 1 0.36 1'); } catch (e) { /* CustomEase 缺失则用默认 */ }
  } catch (e) { /* 注册失败不致命 */ }

  gsap.defaults({ ease: 'power3.out', duration: 0.8 });

  function safe(fn) { try { fn(); } catch (e) { /* 模块隔离，静默降级 */ } }

  /* ============ 1. SplitText 标题字符入场 ============ */
  safe(function () {
    if (!window.SplitText) return;
    document.querySelectorAll('.split-title').forEach(function (el) {
      var split = SplitText.create(el, { type: 'words, chars', mask: 'words' });
      gsap.from(split.chars, {
        yPercent: 110, rotationX: 45, autoAlpha: 0,
        duration: 0.9, ease: 'power3.out', stagger: 0.02, delay: 0.1,
      });
    });
  });

  /* ============ 2. 通用 reveal ============ */
  safe(function () {
    document.querySelectorAll('[data-reveal]').forEach(function (el) {
      gsap.from(el, { y: 34, autoAlpha: 0, duration: 0.85, ease: 'power2.out' });
    });
    document.querySelectorAll('[data-stagger]').forEach(function (parent) {
      var d = parseFloat(parent.getAttribute('data-stagger')) || 0.08;
      gsap.from(parent.children, { y: 30, autoAlpha: 0, duration: 0.6, stagger: d, ease: 'power2.out' });
    });
  });

  /* ============ 3. 数字滚动 ============ */
  safe(function () {
    document.querySelectorAll('[data-count]').forEach(function (el) {
      var target = parseFloat(el.getAttribute('data-count'));
      var suffix = el.getAttribute('data-suffix') || '';
      var obj = { v: 0 };
      gsap.to(obj, {
        v: target, duration: 1.6, ease: 'power2.inOut',
        onUpdate: function () {
          el.textContent = Math.round(obj.v).toLocaleString() + suffix;
        },
      });
    });
  });

  /* ============ 4. 签名：琥珀高亮笔扫过 ============ */
  safe(function () {
    document.querySelectorAll('.hl-sweep').forEach(function (el, i) {
      var brush = document.createElement('span');
      brush.className = 'hl-brush';
      el.appendChild(brush);
      gsap.set(brush, { xPercent: -120 });
      gsap.to(brush, {
        xPercent: 250, duration: 1.1, ease: 'power3.inOut', delay: 0.4 + i * 0.18,
        onComplete: function () { gsap.set(brush, { autoAlpha: 0 }); },
      });
    });
  });

  /* ============ 5. 卡片 3D tilt（仅精确指针设备） ============ */
  safe(function () {
    if (window.matchMedia('(hover: none)').matches) return;
    document.querySelectorAll('.tilt').forEach(function (card) {
      var inner = card.querySelector('.tilt-inner') || card;
      card.addEventListener('mousemove', function (e) {
        var r = card.getBoundingClientRect();
        var rx = ((e.clientY - r.top) / r.height - 0.5) * -10;
        var ry = ((e.clientX - r.left) / r.width - 0.5) * 12;
        gsap.to(inner, { rotationX: rx, rotationY: ry, transformPerspective: 900, duration: 0.4 });
      });
      card.addEventListener('mouseleave', function () {
        gsap.to(inner, { rotationX: 0, rotationY: 0, duration: 0.5, ease: 'power2.out' });
      });
    });
  });

  /* ============ 6. 后台首屏编排 ============ */
  safe(function () {
    if (!document.querySelector('.app-content')) return;
    gsap.from('.app-topbar', { y: -24, autoAlpha: 0, duration: 0.5, ease: 'power2.out' });
    gsap.from('.page-head-admin > *', { y: 22, autoAlpha: 0, duration: 0.7, stagger: 0.08, delay: 0.1 });
    gsap.from('.kpi-card, .hx-card', { y: 36, autoAlpha: 0, scale: 0.97, duration: 0.7, stagger: 0.08, delay: 0.2, ease: 'power3.out' });
  });

  /* ============ 7. 侧边栏入场（CSS 兜底，GSAP 仅增强） ============ */
  /* 可见性由 CSS 动画保证，此处不再触碰 opacity —— 杜绝"点击不了" */
  safe(function () {
    if (!document.querySelector('.sidebar')) return;
    var items = document.querySelectorAll('.side-item');
    if (items.length) {
      gsap.from(items, { x: -16, duration: 0.45, stagger: 0.04, delay: 0.15, ease: 'power2.out', clearProps: 'all' });
    }
  });

  /* ============ 8. 代码行交错（repo 页） ============ */
  safe(function () {
    var lines = document.querySelectorAll('#code .cline');
    if (lines.length) {
      gsap.from(lines, { x: 20, duration: 0.35, stagger: 0.03, delay: 0.25, ease: 'power2.out', clearProps: 'all' });
    }
  });

  /* ============ 9. 折叠侧边栏 ============ */
  safe(function () {
    document.querySelectorAll('.collapse-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var bar = document.querySelector('.sidebar');
        if (!bar) return;
        bar.classList.toggle('collapsed');
        var icon = btn.querySelector('svg');
        if (icon) {
          gsap.to(icon, { rotation: bar.classList.contains('collapsed') ? 180 : 0, duration: 0.3, ease: 'power2.inOut' });
        }
        setTimeout(function () { if (window.ScrollTrigger) ScrollTrigger.refresh(); }, 400);
      });
    });
  });
})();