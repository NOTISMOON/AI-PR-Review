/* =========================================================
   ReviewForge 后台壳 —— 侧边栏注入 (由各后台页面共用)
   通过 <body data-page="dashboard|repo|review"> 决定高亮项
   ========================================================= */
(function () {
  'use strict';
  var page = document.body.getAttribute('data-page') || 'dashboard';

  /* ---------- 平台状态：localStorage 优先，URL query 兜底 ---------- */
  var _q = location.search.match(/[?&]provider=([a-z]+)/);
  var platform = (localStorage.getItem('rf_platform') || (_q ? _q[1] : null) || 'github').toLowerCase();
  platform = (platform === 'gitee') ? 'gitee' : 'github';
  window.RF_PLATFORM = platform;
  var PROFILE = {
    github: { name: 'octocat', plat: 'GitHub', avatar: 'https://avatars.githubusercontent.com/u/583231?v=4' },
    gitee:  { name: 'nicepkg', plat: 'Gitee',  avatar: 'https://gitee.com/nicepkg/avatar/large' }
  };
  var prof = PROFILE[platform];

  var ITEMS = [
    { group: '工作台' },
    { key: 'dashboard', icon: '<path d="M3 3h7v7H3z"/><path d="M14 3h7v7h-7z"/><path d="M14 14h7v7h-7z"/><path d="M3 14h7v7H3z"/>', label: '控制台', href: 'dashboard.html' },
    { key: 'feed', icon: '<path d="M21 12a8 8 0 0 1-8 8H7l-4 4V12a8 8 0 0 1 16 0z"/><path d="M9 9h6M9 13h6"/>', label: 'PR 动态', href: 'review.html' },
    { group: '仓库' },
    { key: 'repos', icon: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>', label: '仓库列表', href: 'repos.html' },
    { key: 'code', icon: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M13 2v7h7"/>', label: '代码浏览', href: 'repo.html' },
    { group: '审查' },
    { key: 'review', icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', label: '待审 PR', href: 'review.html', badge: '3' },
    { key: 'history', icon: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>', label: '审查历史', href: 'history.html' },
    { group: '管理' },
    { key: 'webhook', icon: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M21 7 18 8l-1-3-3-1-3 1-1 3-3 1v3l3 1 3 3 1 3 3-1 1-3 3-1z"/>', label: 'Webhook', href: 'webhook.html' },
    { key: 'settings', icon: '<path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z"/><path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/>', label: '全局设置', href: 'settings.html' },
  ];

  function navHtml() {
    return ITEMS.map(function (it) {
      if (it.group) return '<div class="side-group">' + it.group + '</div>';
      var active = it.key === page ? ' active' : '';
      var badge = it.badge ? '<span class="sb">' + it.badge + '</span>' : '';
      return '<a class="side-item' + active + '" href="' + it.href + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + it.icon + '</svg><span class="txt">' + it.label + '</span>' + badge + '</a>';
    }).join('');
  }

  var sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  sidebar.innerHTML =
    '<div class="sidebar-track">' +
      '<div class="side-top">' +
        '<a class="side-brand" href="dashboard.html">' +
          '<span class="brand-mark" style="width:32px;height:32px;font-size:15px">RF</span>' +
          '<span class="brand-txt">Review<b style="color:var(--amber)">Forge</b></span>' +
        '</a>' +
        '<button class="collapse-btn" aria-label="折叠侧边栏"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg></button>' +
      '</div>' +
      '<div class="side-search">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4-4"/></svg>' +
        '<input type="search" placeholder="搜索仓库 / PR…" aria-label="全局搜索">' +
      '</div>' +
      '<nav class="side-nav">' + navHtml() + '</nav>' +
      '<div class="side-foot">' +
        '<div class="side-user">' +
          '<span class="avatar" style="width:32px;height:32px"><img src="' + prof.avatar + '" alt="' + prof.name + '" width="32" height="32"></span>' +
          '<div class="u"><b>' + prof.name + '</b><span>' + prof.plat + ' · 管理员</span></div>' +
          '<span class="cog"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M21 7 18 8l-1-3-3-1-3 1-1 3-3 1v3l3 1 3 3 1 3 3-1 1-3 3-1z"/></svg></span>' +
        '</div>' +
      '</div>' +
    '</div>';
})();