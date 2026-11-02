function installNewTabPage(tabId) {
  if (document.querySelector('[data-corvid-home-surface]')) return;
  document.body.replaceChildren();
  document.body.style.cssText='margin:0;min-width:0;min-height:0;background:transparent;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
  const host=document.createElement('div');
  host.dataset.corvidHomeSurface='true';
  host.dataset.tabId=tabId;
  host.style.cssText='display:block;width:100%;height:100%;';
  document.body.append(host);
  const root=host.attachShadow({mode:'closed'});
  root.innerHTML=`
    <style>
      :host{--home-page-background:#fbfbfd;--home-page-edge:#fbfbfd;--home-highlight:#f1f2ff;--home-text-color:#202334;--home-secondary-color:#62697b;--home-muted-color:#83899b;--home-mark-color:#5b63db;--home-line:#e6e8ef;--home-line-soft:#e9ebf1;--home-card-background:#ffffffd9;--home-card-hover:#fff;--home-badge-background:#f0f1ff;--home-badge-color:#555ec7;--home-link-color:#555ec7;--home-shadow:#1d28410b;--home-focus:#5b63db16;display:block;width:100%;height:100%;color:var(--home-text-color);background:var(--home-page-background);color-scheme:light;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      @media(prefers-color-scheme:dark){:host{--home-page-background:#171b23;--home-page-edge:#171b23;--home-highlight:#292f4c;--home-text-color:#e7eaf0;--home-secondary-color:#bac3d1;--home-muted-color:#909bad;--home-mark-color:#aab4ff;--home-line:#394251;--home-line-soft:#303947;--home-card-background:#202630dd;--home-card-hover:#282f3b;--home-badge-background:#303858;--home-badge-color:#c4cbff;--home-link-color:#c4cbff;--home-shadow:#00000035;--home-focus:#98a5ff30;color-scheme:dark}}
      *{box-sizing:border-box}
      main{width:min(660px,calc(100% - 40px));min-height:100%;margin:0 auto;padding:clamp(46px,10vh,104px) 0 36px;display:flex;flex-direction:column;align-items:center;background:radial-gradient(ellipse at 50% 8%,var(--home-highlight) 0,var(--home-page-background) 48%,var(--home-page-edge) 100%)}
      .mark{width:34px;height:34px;color:var(--home-mark-color)}.mark svg{width:100%;height:100%}
      .eyebrow{margin:10px 0 0;color:var(--home-muted-color);font-size:10px;font-weight:700;letter-spacing:.18em}
      h1{margin:9px 0 0;color:var(--home-text-color);font-size:25px;font-weight:620;letter-spacing:-.04em}
      .intro{margin:7px 0 20px;color:var(--home-secondary-color);font-size:12px}
      form{width:min(520px,100%);height:48px;display:flex;align-items:center;gap:10px;padding:0 9px 0 15px;border:1px solid var(--home-line);border-radius:14px;background:var(--home-card-hover);box-shadow:0 8px 26px var(--home-shadow)}
      form:focus-within{border-color:var(--home-mark-color);box-shadow:0 0 0 3px var(--home-focus),0 8px 26px var(--home-shadow)}
      form>span{color:var(--home-muted-color);font-size:19px}
      input{min-width:0;flex:1;border:0;outline:0;background:transparent;color:var(--home-text-color);font:inherit;font-size:13px}
      form button{width:31px;height:31px;border:0;border-radius:9px;background:#5b63db;color:white;font-size:18px;cursor:pointer}
      section{width:min(520px,100%);margin-top:34px}
      header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
      h2{margin:0;color:var(--home-secondary-color);font-size:11px;font-weight:650}
      button{font:inherit;cursor:pointer}
      .all{padding:5px 7px;border:0;background:transparent;color:var(--home-link-color);font-size:10px}
      .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
      .bookmark{min-width:0;min-height:68px;display:flex;align-items:center;gap:8px;padding:9px;border:1px solid var(--home-line-soft);border-radius:12px;background:var(--home-card-background);text-align:left}
      .bookmark:hover{border-color:var(--home-mark-color);background:var(--home-card-hover);box-shadow:0 5px 18px var(--home-shadow)}
      .badge{width:27px;height:27px;display:grid;flex:none;place-items:center;border-radius:9px;background:var(--home-badge-background);color:var(--home-badge-color);font-size:12px;font-weight:650}
      .label{min-width:0;display:grid;gap:2px}.label strong,.label small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .label strong{color:var(--home-text-color);font-size:10px;font-weight:600}.label small{color:var(--home-muted-color);font-size:9px}
      .empty{margin:0;padding:15px;border:1px dashed var(--home-line);border-radius:12px;color:var(--home-muted-color);font-size:10px;text-align:center}
      nav{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:22px}
      nav button{min-height:32px;display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--home-line-soft);border-radius:9px;background:var(--home-card-background);color:var(--home-secondary-color);font-size:10px}
      nav button:hover{background:var(--home-card-hover);color:var(--home-text-color)}nav span{color:var(--home-mark-color);font-size:13px}
      @media(max-width:560px){main{width:100%;padding:38px 18px 24px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}section{margin-top:24px}}
    </style>
    <main aria-label="Corvid 浏览起始页">
      <div class="mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M6 20.5C6 12.5 12.2 6 20 6c2.1 0 4 .5 5.8 1.5-5.6 1-9.2 5.4-10.5 10.2-1 3.7-3.8 6.3-7.2 7.8A10 10 0 0 1 6 20.5Z" fill="currentColor"/><path d="M9 25.5c6.8-1.7 12.2-6.8 15.4-14.1.9 1.8 1.4 3.8 1.4 5.9 0 6.1-4.9 11-11 11-2.1 0-4.1-.6-5.8-1.7Z" fill="currentColor" opacity=".55"/></svg></div>
      <p class="eyebrow">CORVID BROWSER</p><h1>想去哪里？</h1><p class="intro">搜索网页，或输入你要访问的网址。</p>
      <form role="search"><span aria-hidden="true">⌕</span><label hidden for="home-search">搜索网页或输入网址</label><input id="home-search" type="search" aria-label="搜索网页或输入网址" placeholder="搜索网页或输入网址" autocomplete="off" spellcheck="false"><button type="submit" aria-label="开始搜索">↗</button></form>
      <section aria-labelledby="home-bookmarks-title"><header><h2 id="home-bookmarks-title">常用书签</h2><button class="all" type="button" data-action="bookmarks">全部书签　→</button></header><div class="grid" role="group" aria-label="当前浏览身份的书签"></div><p class="empty" hidden>保存的书签会显示在这里，方便你从新标签快速打开。</p></section>
      <nav aria-label="常用浏览功能"><button type="button" data-action="history"><span aria-hidden="true">◷</span>浏览历史</button><button type="button" data-action="agent"><span aria-hidden="true">✳</span>Corvid Agent</button></nav>
    </main>`;
  const form=root.querySelector('form'),input=root.querySelector('input'),grid=root.querySelector('.grid'),empty=root.querySelector('.empty');
  const state=next=>{
    grid.replaceChildren();
    const items=(Array.isArray(next?.bookmarks)?next.bookmarks:[]).slice(0,8);
    host.dataset.bookmarkCount=String(items.length);
    for(const item of items){
      let hostName='网站';try{hostName=new URL(item.url).hostname.replace(/^www\./,'')||hostName;}catch{}
      const card=document.createElement('button');card.type='button';card.className='bookmark';card.title=item.url;card.setAttribute('aria-label',`打开书签：${item.title||hostName}`);
      const badge=document.createElement('span');badge.className='badge';badge.setAttribute('aria-hidden','true');badge.textContent=(hostName[0]||'网').toLocaleUpperCase();
      const label=document.createElement('span');label.className='label';const title=document.createElement('strong');title.textContent=item.title||hostName;const domain=document.createElement('small');domain.textContent=hostName;label.append(title,domain);card.append(badge,label);card.addEventListener('click',()=>window.browserHome.action('navigate',item.url));grid.append(card);
    }
    empty.hidden=grid.childElementCount>0;
  };
  window.browserHome?.onState(state);
  form.addEventListener('submit',event=>{event.preventDefault();window.browserHome?.action('navigate',input.value);});
  root.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>window.browserHome?.action('panel',button.dataset.action)));
  requestAnimationFrame(()=>input.focus());
}
module.exports=installNewTabPage;
