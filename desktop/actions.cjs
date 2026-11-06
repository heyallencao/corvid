const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs/promises');
const pageDebugger = require('./page-debugger.cjs');
const pointers = new WeakMap();

// This function is evaluated in an isolated Chromium world belonging to the
// current document. Its registry disappears automatically on navigation.
function pageOperation(operation, args, seed) {
  const registry = globalThis.__corvidRegistry ||= {documentId: seed, next: 1, nodes: new Map(), refs: new WeakMap()};
  const editingHostFor=node=>{
    if(!node?.isContentEditable)return null;
    let host=node;
    while(host.parentElement?.isContentEditable && !host.hasAttribute('contenteditable'))host=host.parentElement;
    return host;
  };
  const refKey = value => {
    const match = /^(?:@(\d+)|ref=(\d+)|ref:[^:]+:(\d+))$/.exec(value);
    return match ? '@'+(match[1] || match[2] || match[3]) : null;
  };
  const refFor = node => {
    let ref=registry.refs.get(node);
    if(!ref){ref='@'+registry.next++;registry.refs.set(node,ref);registry.nodes.set(ref,node);}
    return ref;
  };
  const nodeFor = (target, allowMissing = false) => {
    if (typeof target === 'string') {
      const key=refKey(target);
      if (key) {
        const node=registry.nodes.get(key);
        if (!node || !node.isConnected) throw new Error('Stale or unknown node reference');
        let view=node.ownerDocument.defaultView;
        while (view && view!==window) {
          let frame; try {frame=view.frameElement; if (!frame || frame.contentDocument!==view.document || !frame.isConnected) throw new Error();} catch {throw new Error('Stale or unknown node reference');}
          view=frame.ownerDocument.defaultView;
        }
        if (view!==window) throw new Error('Stale or unknown node reference');
        return node;
      }
    }
    let query=target, nth;
    let textFilter=null;
    if (typeof query==='string') {
      const nthMatch=/^(.*?)\s*>>\s*nth=(-?\d+)\s*$/.exec(query);
      if(nthMatch){query=nthMatch[1];nth=Number(nthMatch[2]);}
      const pseudo=/(.*?)(?::(has-text|text-is)\((['"])(.*?)\3\))\s*$/.exec(query);
      if(pseudo){query=pseudo[1];textFilter={kind:pseudo[2],value:pseudo[4]};}
      if (query.startsWith('loc=css:')) query={by:'css',value:query.slice(8)};
      else if (query.startsWith('css=')) query={by:'css',value:query.slice(4)};
      else if (query.startsWith('xpath=')) query={by:'xpath',value:query.slice(6)};
      else if (query.startsWith('loc=href:')) query={by:'href',value:query.slice(9)};
      else if (query.startsWith('text=')) {
        const text=query.slice(5), quoted=text.length>=2 && ((text[0]==='"' && text.at(-1)==='"') || (text[0]==="'" && text.at(-1)==="'"));
        query={by:'text',value:quoted?text.slice(1,-1):text,exact:quoted};
      } else if (query.startsWith('loc=role:')) {
        const match=/^loc=role:([a-zA-Z][\w-]*)(?:\[name(\*?)=(['"])(.*?)\3\])?$/.exec(query);
        if (!match) throw new Error('Invalid role locator');
        query={by:'role',value:match[1],...(match[4]!==undefined?{name:match[4],exact:match[2]!== '*'}:{})};
      } else query={by:'css',value:query};
    }
    if (!query || typeof query!=='object' || !['css','xpath','text','role','href'].includes(query.by) || typeof query.value!=='string' || !query.value) throw new Error('Invalid locator');
    let scope=document;
    if (query.frame!==undefined) {
      if (typeof query.frame!=='string') throw new Error('Frame must be a CSS selector');
      const frames=document.querySelectorAll(query.frame);
      if (frames.length!==1 || frames[0].localName!=='iframe' || !frames[0].contentDocument) throw new Error('Frame is ambiguous, missing, or cross-origin');
      scope=frames[0].contentDocument;
    }
    const roots=[];
    const visit=root=>{roots.push(root);for(const el of root.querySelectorAll('*')) {if(el.shadowRoot)visit(el.shadowRoot);}};
    visit(scope);
    let matches=[];
    if (query.by==='xpath') {
      const result=scope.evaluate(query.value,scope,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);
      for(let i=0;i<result.snapshotLength;i++){const node=result.snapshotItem(i);if(node?.nodeType===1)matches.push(node);}
    } else if (query.by==='css') {
      for(const root of roots) matches.push(...root.querySelectorAll(query.value));
    } else {
      const normalized=s=>(s||'').replace(/\s+/g,' ').trim();
      const same=(actual,wanted,exact)=>exact ? normalized(actual)===normalized(wanted) : normalized(actual).toLowerCase().includes(normalized(wanted).toLowerCase());
      const name=el=>el.getAttribute('aria-label') || el.getAttribute('title') || el.labels?.[0]?.innerText || el.innerText || el.getAttribute('placeholder') || '';
      const role=el=>el.getAttribute('role') || (editingHostFor(el)===el?'textbox':({button:'button',a:el.hasAttribute('href')?'link':'',select:'combobox',textarea:'textbox',input:el.type==='checkbox'?'checkbox':el.type==='radio'?'radio':['button','submit','reset'].includes(el.type)?'button':'textbox'})[el.localName] || '');
      for(const root of roots) for(const el of root.querySelectorAll('*')) {
        if (query.by==='href' && el.localName==='a' && el.getAttribute('href')===query.value) matches.push(el);
        if (query.by==='role' && role(el)===query.value && (query.name===undefined || same(name(el),query.name,query.exact!==false))) matches.push(el);
        if (query.by==='text' && same(el.innerText,query.value,query.exact!==false)) {
          const childMatch=[...el.children].some(child=>same(child.innerText,query.value,query.exact!==false));
          if(!childMatch)matches.push(el);
        }
      }
    }
    if (textFilter) {
      const normalized=s=>(s||'').replace(/\s+/g,' ').trim();
      matches=matches.filter(el=>{
        const text=normalized(el.innerText);
        return textFilter.kind==='text-is' ? text===normalized(textFilter.value) : text.toLowerCase().includes(normalized(textFilter.value).toLowerCase());
      });
    }
    if (nth!==undefined) {
      const index=nth<0 ? matches.length+nth : nth;
      matches=index>=0 && index<matches.length ? [matches[index]] : [];
    }
    if (matches.length===0 && allowMissing) return null;
    if (matches.length!==1) throw new Error(`Locator matched ${matches.length} elements`);
    return matches[0];
  };
  if (operation === 'snapshot') {
    const options=args.options || {};
    const scope=options.scope || 'page';
    if (!['page','viewport','subtree'].includes(scope)) throw new Error('Invalid snapshot scope');
    if (scope==='subtree' && (typeof options.root!=='string' || !options.root)) throw new Error('Subtree snapshot requires a root reference');
    const all=[]; let inaccessibleFrames=0;
    const interactive='a,button,input,textarea,select,[role],[contenteditable]:not([contenteditable="false"])';
    const frameLabel=el=>{ if(el.id) return '#'+el.id; const name=el.getAttribute('name'); return name ? `${el.localName}[name="${name}"]` : el.localName; };
    const absoluteRect=el=>{
      let rect=el.getBoundingClientRect(), view=el.ownerDocument.defaultView;
      while(view && view!==window){const frame=view.frameElement;if(!frame)return null;const bounds=frame.getBoundingClientRect();rect={left:rect.left+bounds.left,top:rect.top+bounds.top,right:rect.right+bounds.left,bottom:rect.bottom+bounds.top};view=frame.ownerDocument.defaultView;}
      return rect;
    };
    const consider=(el,frame)=>{
      const box=el.getBoundingClientRect(), style=el.ownerDocument.defaultView.getComputedStyle(el);
      if (!(box.width>0 && box.height>0) || style.visibility==='hidden' || style.display==='none') return;
      if (scope==='viewport') {const rect=absoluteRect(el);if(!rect || rect.right<=0 || rect.bottom<=0 || rect.left>=innerWidth || rect.top>=innerHeight) return;}
      all.push({el,frame});
    };
    const collect=(root,frame)=>{
      for (const el of root.querySelectorAll('*')) {
        if (el.matches(interactive)) consider(el,frame ?? null);
        if (el.shadowRoot) collect(el.shadowRoot,frame ?? null);
        if (el.localName==='iframe') { try { if (el.contentDocument) collect(el.contentDocument,frame ?? frameLabel(el)); else inaccessibleFrames++; } catch { inaccessibleFrames++; } }
      }
    };
    if (scope==='subtree') {
      const root=nodeFor(options.root);
      if (root.localName==='iframe') {
        if (!root.contentDocument) throw new Error('Snapshot root frame is cross-origin or unavailable');
        collect(root.contentDocument,frameLabel(root));
      } else {
        if (root.matches(interactive)) consider(root,null);
        collect(root,null);
        if (root.shadowRoot) collect(root.shadowRoot,null);
      }
    } else collect(document,null);
    const items=all.slice(0,200).map(({el,frame})=>({ref:refFor(el),role:el.getAttribute('role') || (editingHostFor(el)===el?'textbox':(el.tagName || '').toLowerCase()),name:el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.getAttribute('placeholder') || '',frame:frame ?? null}));
    return {url:location.href,title:document.title,scope,items,truncated:all.length>200,total:all.length,limitations:['Accessible names are approximate; closed shadow roots and cross-origin iframe contents are not included.'],inaccessibleFrames};
  }
  if(operation==='viewport')return {width:innerWidth,height:innerHeight,devicePixelRatio:devicePixelRatio};
  const element=nodeFor(args.target,operation==='selector-state');
  if(operation==='selector-state') {
    if(!element)return {attached:false,visible:false};
    let node=element,visible=true;
    while(node) {
      const view=node.ownerDocument.defaultView,rect=node.getBoundingClientRect(),style=view.getComputedStyle(node);
      if(rect.width<=0 || rect.height<=0 || style.display==='none' || ['hidden','collapse'].includes(style.visibility)) {visible=false;break;}
      if(view===window)break;
      node=view.frameElement;
      if(!node) {visible=false;break;}
    }
    return {attached:true,visible};
  }
  if (operation==='resolve') return {ref:refFor(element)};
  if (operation==='file-validate') {
    const win=element.ownerDocument.defaultView;
    if (!(element instanceof win.HTMLInputElement) || element.type!=='file' || element.disabled) throw new Error('Target must be an enabled file input');
    if (element.webkitdirectory) throw new Error('Directory upload is not supported');
    if (!element.multiple && args.count>1) throw new Error('File input does not allow multiple files');
    globalThis.__corvidUploadContext=args.nonce;
    return {ok:true};
  }
  if (operation==='file-clear') {
    const win=element.ownerDocument.defaultView;
    if (!(element instanceof win.HTMLInputElement) || element.type!=='file' || element.disabled) throw new Error('Target must be an enabled file input');
    element.value='';
    element.dispatchEvent(new win.Event('input',{bubbles:true}));
    element.dispatchEvent(new win.Event('change',{bubbles:true}));
    return {ok:true};
  }
  if (operation==='select') {
    let select=element.localName==='select' ? element : (element.control?.localName==='select' ? element.control : null);
    if(!select) {
      const candidates=[];
      const collect=root=>{for(const child of root.querySelectorAll('*')){if(child.localName==='select')candidates.push(child);if(child.shadowRoot)collect(child.shadowRoot);}};
      collect(element);if(candidates.length!==1)throw new Error(`Target contains ${candidates.length} select controls`);select=candidates[0];
    }
    const view=select.ownerDocument.defaultView, rect=select.getBoundingClientRect(),style=view.getComputedStyle(select);
    if(!select.isConnected || select.matches(':disabled'))throw new Error('Select is disabled or detached');
    if(rect.width<=0 || rect.height<=0 || style.visibility==='hidden' || style.display==='none')throw new Error('Select is not visible');
    const choices=args.choices===null ? [] : (Array.isArray(args.choices) ? args.choices : [args.choices]);
    for(const choice of choices){
      if(typeof choice==='string')continue;
      if(!choice || typeof choice!=='object' || Array.isArray(choice) || !Object.keys(choice).length || Object.keys(choice).some(key=>!['value','label','index'].includes(key)) || (choice.value!==undefined && typeof choice.value!=='string') || (choice.label!==undefined && typeof choice.label!=='string') || (choice.index!==undefined && (!Number.isInteger(choice.index) || choice.index<0)))throw new Error('Invalid select option');
    }
    const options=Array.from(select.options);
    const matches=(option,index,choice)=>typeof choice==='string' ? option.value===choice || option.label===choice : (choice.value===undefined || option.value===choice.value) && (choice.label===undefined || option.label===choice.label) && (choice.index===undefined || index===choice.index);
    const selected=[];
    if(select.multiple){for(const choice of choices){const index=options.findIndex((option,i)=>matches(option,i,choice));if(index<0)throw new Error('Select option not found');if(!selected.includes(index))selected.push(index);}}
    else if(choices.length){const index=options.findIndex((option,i)=>choices.some(choice=>matches(option,i,choice)));if(index<0)throw new Error('Select option not found');selected.push(index);}
    if(!selected.length)select.selectedIndex=-1;
    else if(select.multiple)options.forEach((option,index)=>{option.selected=selected.includes(index);});
    else select.selectedIndex=selected[0];
    const values=Array.from(select.selectedOptions,option=>option.value);
    select.dispatchEvent(new view.Event('input',{bubbles:true,composed:true}));
    select.dispatchEvent(new view.Event('change',{bubbles:true}));
    return {selected:values};
  }
  if (operation==='text') return {value:element.innerText ?? element.textContent ?? ''};
  if (operation==='exists') return {ok:true};
  if (operation==='prepare-input') {
    if (!element.isConnected || element.disabled) throw new Error('Element is unavailable');
    if(!args.noScroll) element.scrollIntoView({block:'center', inline:'center', behavior:'instant'});
    const rect=element.getBoundingClientRect(), doc=element.ownerDocument, view=doc.defaultView;
    let x=Math.floor(rect.left+rect.width/2), y=Math.floor(rect.top+rect.height/2);
    const root=element.getRootNode(); const hit=root.elementFromPoint ? root.elementFromPoint(x,y) : doc.elementFromPoint(x,y);
    if (rect.width<=0 || rect.height<=0 || x<0 || y<0 || x>=view.innerWidth || y>=view.innerHeight || !(hit===element || element.contains(hit))) throw new Error('Element is not visible or is covered');
    let current=view;
    while(current!==window) {
      const frame=current.frameElement; if (!frame || frame.contentDocument!==current.document) throw new Error('Stale or unsupported frame');
      const bounds=frame.getBoundingClientRect(); x+=bounds.left+frame.clientLeft; y+=bounds.top+frame.clientTop;
      const parent=frame.ownerDocument, frameRoot=frame.getRootNode(); const ancestorHit=frameRoot.elementFromPoint ? frameRoot.elementFromPoint(x,y) : parent.elementFromPoint(x,y);
      if (!(ancestorHit===frame || frame.contains(ancestorHit))) throw new Error('Frame is not visible or is covered');
      current=parent.defaultView;
    }
    if (args.kind==='fill') {
      const win=element.ownerDocument.defaultView;
      const supported=element instanceof win.HTMLTextAreaElement || (element instanceof win.HTMLInputElement && ['text','search','url','tel','password'].includes(element.type));
      if ((!supported && !editingHostFor(element)) || (supported && element.readOnly)) throw new Error('Fill supports editable text inputs, textareas, and contenteditable hosts only');
    }
    return {x,y};
  }
  if (operation==='select-text') {
    const host=editingHostFor(element);
    if(host) {
      if(element.getRootNode().activeElement!==host)throw new Error('Input focus was not acquired');
      // Scope selection to the editing host; Meta+A did not reliably select contenteditable in Electron on macOS.
      const selection=host.ownerDocument.getSelection(),range=host.ownerDocument.createRange();
      range.selectNodeContents(host);selection.removeAllRanges();selection.addRange(range);
      return {ok:true,contentEditable:true};
    }
    if (!(element instanceof element.ownerDocument.defaultView.HTMLInputElement || element instanceof element.ownerDocument.defaultView.HTMLTextAreaElement) || element.getRootNode().activeElement!==element) throw new Error('Input focus was not acquired');
    element.select(); return {ok:true,contentEditable:false};
  }
  if (operation==='focus-target') {
    if (!element.isConnected || element.disabled) throw new Error('Element is unavailable');
    element.focus();
    if (element.getRootNode().activeElement!==element) throw new Error('Input focus was not acquired');
    return {ok:true};
  }
  if (operation==='focus-element') {
    if (!element.isConnected || element.disabled) throw new Error('Element is unavailable');
    element.focus({preventScroll:true});
    if (element.getRootNode().activeElement!==element) throw new Error('Element could not be focused');
    return {ok:true};
  }
  if (operation==='verify-focus') {
    if (element.getRootNode().activeElement!==element) throw new Error('Input focus was not acquired');
    return {ok:true};
  }
  throw new Error('Unsupported operation');
}
module.exports = async function runAction(contents, operation, args = {}, hooks = {}) {
  const reportInput = (action, point) => {
    try { hooks.onInput?.({ operation:action, point:{x:point.x,y:point.y} }); } catch {}
  };
  const run = async (op, options) => {
    const code=`(()=>{try{return {ok:true,result:(${pageOperation.toString()})(${JSON.stringify(op)},${JSON.stringify(options)},${JSON.stringify(crypto.randomUUID())})}}catch(error){return {ok:false,error:String(error.message || error)}}})()`;
    const result=await contents.executeJavaScriptInIsolatedWorld(4815,[{code}]);
    if(!result.ok) throw new Error(result.error);
    return result.result;
  };
  if (operation === 'screenshot') {
    if(args.fullPage!==undefined && typeof args.fullPage!=='boolean')throw new Error('fullPage must be boolean');
    if(args.fullPage && args.clip!==undefined)throw new Error('fullPage and clip cannot be combined');
    if(!args.fullPage && args.clip===undefined) {
      try { return {base64:(await contents.capturePage()).toPNG().toString('base64')}; }
      catch(error) {
        if(!String(error?.message || error).includes('UnknownVizError'))throw error;
        // Some macOS runners have no capturable Viz surface even though the
        // page debugger is available. Capture the visible CSS viewport via CDP.
        if(!pageDebugger.available(contents))await pageDebugger.ensure(contents);
        const metrics=await contents.debugger.sendCommand('Page.getLayoutMetrics');
        const viewport=metrics.cssVisualViewport || metrics.cssLayoutViewport;
        if(!viewport || !Number.isFinite(viewport.clientWidth) || !Number.isFinite(viewport.clientHeight))throw new Error('Page viewport size is unavailable');
        const {devicePixelRatio}=await run('viewport',{});
        if(!Number.isFinite(devicePixelRatio) || devicePixelRatio<=0)throw new Error('Page device scale factor is unavailable');
        const result=await contents.debugger.sendCommand('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,clip:{x:0,y:0,width:viewport.clientWidth,height:viewport.clientHeight,scale:1/devicePixelRatio}});
        return {base64:result.data};
      }
    }
    if(!pageDebugger.available(contents))throw new Error('Page debugger is unavailable');
    let clip=args.clip;
    if(args.fullPage) {const metrics=await contents.debugger.sendCommand('Page.getLayoutMetrics');const size=metrics.cssContentSize;if(!size)throw new Error('Page content size is unavailable');clip={x:0,y:0,width:Math.ceil(size.width),height:Math.ceil(size.height)};}
    if(!clip || typeof clip!=='object' || Array.isArray(clip) || Object.keys(clip).some(key=>!['x','y','width','height'].includes(key)) || ['x','y','width','height'].some(key=>typeof clip[key]!=='number' || !Number.isFinite(clip[key])) || clip.x<0 || clip.y<0 || clip.width<=0 || clip.height<=0 || clip.width>16384 || clip.height>16384 || clip.width*clip.height>32000000)throw new Error('Invalid or oversized screenshot clip');
    const {devicePixelRatio}=await run('viewport',{});
    const result=await contents.debugger.sendCommand('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{...clip,scale:1/devicePixelRatio}});
    return {base64:result.data};
  }
  if (operation === 'evaluate') {
    if (typeof args.expression !== 'string') throw new Error('Expression must be a string');
    const result=await contents.executeJavaScript(`Promise.resolve((${args.expression})).then(value => JSON.stringify({value}))`);
    const parsed=JSON.parse(result); if (!Object.hasOwn(parsed,'value')) throw new Error('Evaluation result is not JSON serializable'); return parsed;
  }
  if (operation === 'wait') {
    const timeout=Math.min(Math.max(Number(args.options?.timeout ?? 5000),0),10000); const deadline=Date.now()+timeout;
    do { try { return await run('exists',args); } catch(error) { if(!String(error.message).includes('Locator matched 0 elements')) throw error; if(Date.now()>=deadline) throw new Error('Wait timed out'); await new Promise(resolve=>setTimeout(resolve,Math.min(100,deadline-Date.now()))); } } while(true);
  }
  if (operation === 'scroll') {
    const {deltaX,deltaY,x,y}=args;
    if(!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || Math.abs(deltaX)>2000 || Math.abs(deltaY)>2000 || (deltaX===0 && deltaY===0))throw new Error('Scroll deltas must be finite, within -2000..2000, and not both zero');
    if((x===undefined)!==(y===undefined) || (x!==undefined && (!Number.isFinite(x) || !Number.isFinite(y))))throw new Error('Scroll coordinates must be finite and supplied together');
    const viewport=await run('viewport',{});
    const point=x===undefined?{x:Math.floor(viewport.width/2),y:Math.floor(viewport.height/2)}:{x,y};
    if(point.x<0 || point.y<0 || point.x>=viewport.width || point.y>=viewport.height)throw new Error('Scroll coordinates are outside the viewport');
    // CDP mouseWheel is ignored by hidden background WebContentsView targets; use a mouse-source scroll gesture so background Rooms scroll without activation.
    reportInput(operation,point);
    await pageDebugger.ensure(contents);
    await contents.debugger.sendCommand('Input.synthesizeScrollGesture',{x:point.x,y:point.y,xDistance:-deltaX,yDistance:-deltaY,gestureSourceType:'mouse',speed:1200,preventFling:true});
    return {ok:true,point};
  }
  if (operation === 'setInputFiles') {
    await validateFiles(args.files);
    const {ref}=await run('resolve',args);
    const nonce=crypto.randomUUID();
    await run('file-validate',{target:ref,count:args.files.length,nonce});
    if(args.files.length===0) return run('file-clear',{target:ref});
    return setFiles(contents,ref,args.files,nonce);
  }
  if (['mouseMove','mouseDown','mouseUp','mouseClick','mouseWheel'].includes(operation)) return pointerAction(contents,operation,args,run);
  if (operation==='dragAndDrop') {
    const source=await run('resolve',{target:args.source}),target=await run('resolve',{target:args.target});
    await run('prepare-input',{target:target.ref});
    const from=await run('prepare-input',{target:source.ref});
    const to=await run('prepare-input',{target:target.ref,noScroll:true});
    return drag(contents,from,to,run);
  }
  if (operation==='hover') {const {ref}=await run('resolve',args);const point=await run('prepare-input',{target:ref});reportInput(operation,point);return pointerAction(contents,'mouseMove',point,run);}
  if (operation==='dblclick') {const {ref}=await run('resolve',args);const point=await run('prepare-input',{target:ref});return doubleClick(contents,point);}
  if (operation==='focus') {const {ref}=await run('resolve',args);return run('focus-element',{target:ref});}
  if (['keyboardDown','keyboardUp','keyboardPress','keyboardType','keyboardInsertText','keyboardPaste'].includes(operation)) return keyboardAction(contents,operation,args);
  if (operation==='cdp') {
    if(typeof args.method!=='string' || !args.method)throw new Error('CDP method is required');
    if(args.params!==undefined && (args.params===null || typeof args.params!=='object' || Array.isArray(args.params)))throw new Error('CDP params must be an object');
    await pageDebugger.ensure(contents);
    try {return {result:await contents.debugger.sendCommand(args.method,args.params || {})};}
    catch(error) {throw new Error(`CDP ${args.method} failed: ${error.message}`);}
  }
  if (['click','fill','press'].includes(operation)) { const {ref}=await run('resolve',args); return trustedInput(contents, operation, {...args,target:ref}, run, reportInput); }
  if (!['snapshot','text','select','selector-state'].includes(operation)) throw new Error('Unsupported operation');
  return run(operation,args);
};
async function validateFiles(files) {
  if (!Array.isArray(files) || files.some(file=>typeof file!=='string' || !path.isAbsolute(file))) throw new Error('Files must be an array of absolute paths');
  for (const file of files) {const info=await fs.stat(file);if(!info.isFile()) throw new Error(`Not a regular file: ${file}`);}
}
module.exports.validateFiles=validateFiles;
function pointerState(contents) {let state=pointers.get(contents);if(!state){state={x:0,y:0,buttons:0};pointers.set(contents,state);}return state;}
async function pointerAction(contents,operation,args,run) {
  const state=pointerState(contents);await pageDebugger.ensure(contents);
  const send=(type,fields={})=>contents.debugger.sendCommand('Input.dispatchMouseEvent',{type,x:state.x,y:state.y,buttons:state.buttons,...fields});
  const button=args.button ?? 'left',mask={left:1,right:2,middle:4}[button];
  if(['mouseDown','mouseUp','mouseClick'].includes(operation) && !mask)throw new Error('Unsupported mouse button');
  if(operation==='mouseClick' && state.buttons)throw new Error('Release held mouse buttons before clicking');
  if(operation==='mouseMove' || operation==='mouseClick') {
    if(!Number.isFinite(args.x) || !Number.isFinite(args.y))throw new Error('Mouse coordinates must be finite numbers');
    const viewport=await run('viewport',{});if(args.x<0 || args.y<0 || args.x>=viewport.width || args.y>=viewport.height)throw new Error('Mouse coordinates are outside the viewport');
    const button=state.buttons & 1 ? 'left' : state.buttons & 2 ? 'right' : state.buttons & 4 ? 'middle' : 'none';
    await contents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:args.x,y:args.y,button,buttons:state.buttons});state.x=args.x;state.y=args.y;
  }
  if(operation==='mouseDown' || operation==='mouseClick') {
    if(state.buttons & mask)throw new Error('Mouse button is already down');
    await send('mousePressed',{button,buttons:state.buttons|mask,clickCount:1});state.buttons|=mask;
    if(operation==='mouseClick')await new Promise(resolve=>setTimeout(resolve,30));
  }
  if(operation==='mouseUp' || operation==='mouseClick') {
    if(!(state.buttons & mask))throw new Error('Mouse button is not down');
    await send('mouseReleased',{button,buttons:state.buttons & ~mask,clickCount:1});state.buttons &= ~mask;
  }
  if(operation==='mouseWheel') {
    if(!Number.isFinite(args.deltaX) || !Number.isFinite(args.deltaY))throw new Error('Wheel deltas must be finite numbers');
    await send('mouseWheel',{deltaX:args.deltaX,deltaY:args.deltaY});
  }
  return {ok:true};
}
async function drag(contents,from,to,run) {
  const state=pointerState(contents);if(state.buttons)throw new Error('Release held mouse buttons before dragging');
  await pageDebugger.ensure(contents);
  let dragData;const listener=(_event,method,params)=>{if(method==='Input.dragIntercepted')dragData=params.data;};
  contents.debugger.on('message',listener);
  try {
    await contents.debugger.sendCommand('Input.setInterceptDrags',{enabled:true});
    await pointerAction(contents,'mouseMove',from,run);await pointerAction(contents,'mouseDown',{button:'left'},run);
    for(let step=1;step<=10;step++)await pointerAction(contents,'mouseMove',{x:from.x+(to.x-from.x)*step/10,y:from.y+(to.y-from.y)*step/10},run);
    // Chromium emits dragIntercepted only when the gesture starts an HTML drag.
    if(dragData){for(const type of ['dragEnter','dragOver','drop'])await contents.debugger.sendCommand('Input.dispatchDragEvent',{type,x:to.x,y:to.y,data:dragData});}
  } finally {
    try {if(state.buttons & 1)await pointerAction(contents,'mouseUp',{button:'left'},run);}
    finally {try {if(contents.debugger.isAttached())await contents.debugger.sendCommand('Input.setInterceptDrags',{enabled:false});} finally {contents.debugger.removeListener('message',listener);}}
  }
  return {ok:true};
}
module.exports.releasePointer=async function(contents) {
  const state=pointers.get(contents);if(!state || !state.buttons)return;
  if(!contents.debugger.isAttached())throw new Error('Cannot release held mouse buttons: page debugger unavailable');
  for(const [button,mask] of [['left',1],['right',2],['middle',4]])if(state.buttons & mask){await contents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:state.x,y:state.y,button,buttons:state.buttons & ~mask,clickCount:1});state.buttons &= ~mask;}
};

async function setFiles(contents,ref,files,nonce) {
  await pageDebugger.ensure(contents);
  const contexts=new Set();
  const listener=(_event,method,params)=>{if(method==='Runtime.executionContextCreated')contexts.add(params.context.id);};
  contents.debugger.on('message',listener);
  let objectId;
  try {
    await contents.debugger.sendCommand('Runtime.enable');
    let contextId;
    for(const id of contexts) {
      try {const value=await contents.debugger.sendCommand('Runtime.evaluate',{contextId:id,expression:`globalThis.__corvidUploadContext===${JSON.stringify(nonce)}`,returnByValue:true});if(value.result.value===true){contextId=id;break;}}catch{}
    }
    if(contextId===undefined) throw new Error('File input execution context is unavailable');
    const expression=`(()=>{const n=globalThis.__corvidRegistry?.nodes.get(${JSON.stringify(ref)});if(!n||!n.isConnected||n.localName!=='input'||n.type!=='file'||n.disabled||n.webkitdirectory||(!n.multiple&&${files.length}>1))throw new Error('Stale or unavailable file input');let v=n.ownerDocument.defaultView;while(v&&v!==window){const f=v.frameElement;if(!f||!f.isConnected||f.contentDocument!==v.document)throw new Error('Stale frame');v=f.ownerDocument.defaultView;}if(v!==window)throw new Error('Stale frame');return n;})()`;
    const evaluated=await contents.debugger.sendCommand('Runtime.evaluate',{contextId,expression,objectGroup:'corvid-upload'});
    if(evaluated.exceptionDetails || !evaluated.result.objectId) throw new Error('Stale or unavailable file input');
    objectId=evaluated.result.objectId;
    await contents.debugger.sendCommand('DOM.setFileInputFiles',{objectId,files});
    return {ok:true};
  } finally {
    if(objectId && contents.debugger.isAttached()) await contents.debugger.sendCommand('Runtime.releaseObjectGroup',{objectGroup:'corvid-upload'}).catch(()=>{});
    if(contents.debugger.isAttached()) await contents.debugger.sendCommand('Runtime.disable').catch(()=>{});
    contents.debugger.removeListener('message',listener);
  }
}

// The page debugger has one owner and remains attached for dialog events.
async function trustedInput(contents, operation, args, run, reportInput) {
  if (operation === 'fill' && typeof args.value !== 'string') throw new Error('Fill value must be a string');
  const keyEvent = operation === 'press' ? parseKey(args.key) : null;
  const point = ['click','fill'].includes(operation) ? await run('prepare-input', {target:args.target, kind:operation}) : null;
  if (operation === 'press') await run('focus-target', {target:args.target});
  await pageDebugger.ensure(contents);
  {
    const send = (method, params) => contents.debugger.sendCommand(method,params);
    if (point) {
      reportInput(operation,point);
      try {await pointerAction(contents,'mouseClick',point,run);}
      catch(error) {await module.exports.releasePointer(contents).catch(()=>{});throw error;}
    }
    if (operation === 'fill') {
      const deadline=Date.now()+500;
      for (;;) {
        try { await run('select-text',{target:args.target}); break; }
        catch (error) { if (!String(error.message).includes('focus was not acquired') || Date.now()>=deadline) throw error; await new Promise(resolve=>setTimeout(resolve,20)); }
      }
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
      await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
      if(args.value)await send('Input.insertText',{text:args.value});
    }
    const keypress = async event => {
      await send('Input.dispatchKeyEvent',{type:'keyDown',...event});
      const {commands,...keyUpEvent}=event;
      await send('Input.dispatchKeyEvent',{type:'keyUp',...keyUpEvent,text:undefined});
    };
    if (operation === 'press') {
      await run('verify-focus',{target:args.target});
      await keypress(keyEvent);
    }
    return {ok:true};
  }
}

function editingCommands(key, modifiers) {
  if (process.platform !== 'darwin' || !(modifiers & 4)) return [];
  const shift = Boolean(modifiers & 8);
  if (!shift && key.toLowerCase() === 'a') return ['selectAll'];
  if (key === 'ArrowLeft') return [shift ? 'moveToLeftEndOfLineAndModifySelection' : 'moveToLeftEndOfLine'];
  if (key === 'ArrowRight') return [shift ? 'moveToRightEndOfLineAndModifySelection' : 'moveToRightEndOfLine'];
  return [];
}

function parseKey(value) {
  if (typeof value !== 'string' || !value) throw new Error('Key is required');
  const parts=value.split('+'); const key=parts.pop();
  const masks={Alt:1,Control:2,Ctrl:2,Meta:4,Command:4,Shift:8};
  let modifiers=0;
  for(const modifier of parts) { if (!Object.hasOwn(masks, modifier) || (modifiers & masks[modifier])) throw new Error('Unsupported key modifier'); modifiers |= masks[modifier]; }
  const special={Enter:13,Tab:9,Escape:27,Backspace:8,Delete:46,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,Home:36,End:35,' ':32};
  let code, vk;
  if (Object.hasOwn(special, key)) {code=key===' '?'Space':key;vk=special[key];}
  else if (/^[a-zA-Z]$/.test(key)) {code=`Key${key.toUpperCase()}`;vk=key.toUpperCase().charCodeAt(0);}
  else if (/^[0-9]$/.test(key)) {code=`Digit${key}`;vk=key.charCodeAt(0);}
  else throw new Error('Unsupported key; use letters, digits, space, or documented named keys');
  const printable=key.length===1 && !(modifiers & (1|2|4));
  const commands=editingCommands(key,modifiers);
  return {key,code,windowsVirtualKeyCode:vk,modifiers,...(printable ? {text:key} : {}),...(commands.length ? {commands} : {})};
}

const keyboardStates = new WeakMap();
const KEY_BITS = {Alt:1,Control:2,Ctrl:2,Meta:4,Command:4,Shift:8};
const MODIFIER_BITS = {Shift:8,Control:2,Alt:1,Meta:4};
const MODIFIER_CODES = {Shift:'ShiftLeft',Control:'ControlLeft',Alt:'AltLeft',Meta:'MetaLeft'};
const MODIFIER_VK = {Shift:16,Control:17,Alt:18,Meta:91};
const NAMED_KEYS = {Enter:13,Tab:9,Escape:27,Backspace:8,Delete:46,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,Home:36,End:35};

function keyboardState(contents) {let state=keyboardStates.get(contents);if(!state){state={modifiers:0};keyboardStates.set(contents,state);}return state;}

function parseKeySpec(value) {
  if (typeof value!=='string' || !value) throw new Error('Key is required');
  const parts=value.split('+'), key=parts.pop();
  if(!key) throw new Error('Key is required');
  let modifiers=0;
  for(const modifier of parts) {if(!Object.hasOwn(KEY_BITS,modifier)) throw new Error('Unsupported key modifier');modifiers|=KEY_BITS[modifier];}
  const normalized=key==='Command'?'Meta':key;
  if(Object.hasOwn(MODIFIER_BITS,normalized)) return {modifier:normalized,key:normalized,code:MODIFIER_CODES[normalized],vk:MODIFIER_VK[normalized],modifiers};
  if(normalized===' ') return {key:' ',code:'Space',vk:32,modifiers,text:' '};
  if(Object.hasOwn(NAMED_KEYS,normalized)) return {key:normalized,code:normalized,vk:NAMED_KEYS[normalized],modifiers};
  if(/^[a-zA-Z]$/.test(normalized)) return {key:normalized.toLowerCase(),code:`Key${normalized.toUpperCase()}`,vk:normalized.toUpperCase().charCodeAt(0),modifiers,text:normalized.toLowerCase()};
  if(/^[0-9]$/.test(normalized)) return {key:normalized,code:`Digit${normalized}`,vk:normalized.charCodeAt(0),modifiers,text:normalized};
  throw new Error('Unsupported key; use letters, digits, space, or documented named keys');
}

async function dispatchChord(contents, chord) {
  const parts=chord.split('+'), key=parts.pop();
  const mods=parts.map(modifier=>modifier==='Command'?'Meta':modifier);
  let mask=0;for(const modifier of mods) mask|=MODIFIER_BITS[modifier];
  for(const modifier of mods) await contents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:modifier,code:MODIFIER_CODES[modifier],windowsVirtualKeyCode:MODIFIER_VK[modifier],modifiers:mask});
  const spec=parseKeySpec(key);
  await contents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:spec.key,code:spec.code,windowsVirtualKeyCode:spec.vk,modifiers:mask,...(spec.text===undefined?{}:{text:spec.text})});
  await contents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:spec.key,code:spec.code,windowsVirtualKeyCode:spec.vk,modifiers:mask});
  for(const modifier of [...mods].reverse()) await contents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:modifier,code:MODIFIER_CODES[modifier],windowsVirtualKeyCode:MODIFIER_VK[modifier],modifiers:mask & ~MODIFIER_BITS[modifier]});
}

async function keyboardAction(contents, operation, args) {
  await pageDebugger.ensure(contents);
  const send=(method,params)=>contents.debugger.sendCommand(method,params);
  const state=keyboardState(contents);
  if (operation==='keyboardType' || operation==='keyboardInsertText') {
    if (typeof args.text!=='string' || (operation==='keyboardType' && !args.text)) throw new Error('text is required');
    await send('Input.insertText',{text:args.text});
    return {ok:true};
  }
  if (operation==='keyboardPaste') {
    if (!args || (typeof args.text!=='string' && typeof args.html!=='string')) throw new Error('paste requires text or html');
    const electronModule=require('electron');
    const clipboard=electronModule.clipboard;
    if(!clipboard) throw new Error(`paste unavailable: electron.clipboard missing (keys: ${Object.keys(electronModule).slice(0,12).join(',')})`);
    let previous;
    try { previous={text:clipboard.readText(),html:typeof clipboard.readHTML==='function'?clipboard.readHTML():null}; }
    catch(error) { throw new Error(`paste cannot read clipboard: ${error.message}`); }
    try {
      if (typeof args.html==='string' && typeof clipboard.write==='function') clipboard.write({text:args.text ?? '',html:args.html});
      else clipboard.writeText(args.text);
      contents.paste();
      await new Promise(resolve=>setTimeout(resolve,80));
      return {ok:true};
    } finally {
      // Restoring the user's clipboard is best effort: a failed restore must not
      // turn a successful paste into an error.
      try {
        if (previous.html!==null && typeof clipboard.write==='function') clipboard.write({text:previous.text,html:previous.html});
        else if (previous.text) clipboard.writeText(previous.text);
        else clipboard.clear();
      } catch {}
    }
  }
  const spec=parseKeySpec(args.key);
  const base={key:spec.key,code:spec.code,windowsVirtualKeyCode:spec.vk,modifiers:state.modifiers|spec.modifiers};
  if (spec.modifier) {
    const bit=MODIFIER_BITS[spec.modifier];
    if (operation==='keyboardUp') {
      await send('Input.dispatchKeyEvent',{type:'keyUp',...base});
      state.modifiers&=~bit;
    } else {
      state.modifiers|=bit;
      await send('Input.dispatchKeyEvent',{type:'keyDown',...base,modifiers:state.modifiers});
      if (operation==='keyboardPress') {
        await send('Input.dispatchKeyEvent',{type:'keyUp',...base,modifiers:state.modifiers});
        state.modifiers&=~bit;
      }
    }
    return {ok:true};
  }
  const text=spec.text!==undefined && !(base.modifiers & (1|2|4)) ? ((base.modifiers&8) ? spec.text.toUpperCase() : spec.text) : undefined;
  const commands=editingCommands(spec.key,base.modifiers);
  if (operation!=='keyboardUp') await send('Input.dispatchKeyEvent',{type:'keyDown',...base,...(text===undefined?{}:{text}),...(commands.length?{commands}:{})});
  if (operation!=='keyboardDown') await send('Input.dispatchKeyEvent',{type:'keyUp',...base});
  return {ok:true};
}

async function doubleClick(contents, point) {
  const state=pointerState(contents);
  if(state.buttons) throw new Error('Release held mouse buttons before clicking');
  await pageDebugger.ensure(contents);
  const send=(type,fields={})=>contents.debugger.sendCommand('Input.dispatchMouseEvent',{type,x:point.x,y:point.y,...fields});
  await send('mouseMoved',{button:'none',buttons:0});
  await send('mousePressed',{button:'left',buttons:1,clickCount:1});
  await send('mouseReleased',{button:'left',buttons:0,clickCount:1});
  await send('mousePressed',{button:'left',buttons:1,clickCount:2});
  await send('mouseReleased',{button:'left',buttons:0,clickCount:2});
  state.x=point.x;state.y=point.y;
  return {ok:true};
}
