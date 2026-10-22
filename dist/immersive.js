// Browser fullscreen needs a visitor's tap. Home Screen launches use the
// manifest instead, so an unsupported browser never blocks entering the shop.
export function setupImmersive({announce=()=>{},doc=globalThis.document,win=globalThis.window}={}) {
  const root=doc.documentElement,button=doc.querySelector('#fullscreen');
  const help=doc.querySelector('#fullscreen-help'),intro=doc.querySelector('#fullscreen-intro-note');
  const display=win.matchMedia?.('(display-mode: standalone)'),fullDisplay=win.matchMedia?.('(display-mode: fullscreen)');
  const navigator=win.navigator||{};
  const isApple=/iPhone|iPad|iPod/i.test(navigator.userAgent||'')||(/Macintosh/i.test(navigator.userAgent||'')&&navigator.maxTouchPoints>1);
  let attemptedEntry=false,pending=null,wasRequested=false;
  const active=()=>Boolean(doc.fullscreenElement||doc.webkitFullscreenElement);
  const standalone=()=>Boolean(navigator.standalone||display?.matches||fullDisplay?.matches);
  const request=()=>typeof root.requestFullscreen==='function'&&doc.fullscreenEnabled!==false
    ?()=>root.requestFullscreen({navigationUI:'hide'})
    :typeof root.webkitRequestFullscreen==='function'&&doc.webkitFullscreenEnabled!==false
      ?()=>root.webkitRequestFullscreen():null;
  const guidance=()=>isApple
    ?'For a screen without browser bars, use Share → Add to Home Screen. If shown, turn on Open as Web App. Then open the shop from its new icon.'
    :'For a screen without browser bars, use your browser’s menu to install this shop or add it to your Home Screen. Then open its icon.';
  function showHelp(message,spoken=false){
    if(help){help.textContent=message;help.hidden=false;}
    if(intro){intro.textContent='For a screen without browser bars, open the shop from your Home Screen. Screen instructions are in Comfort and sound settings.';intro.hidden=false;}
    if(spoken)announce(message);
  }
  function sync(){
    const filled=active(),installed=standalone();
    doc.body?.classList.toggle('immersive',filled||installed);
    if(button){
      button.hidden=installed&&!filled;
      button.textContent=filled?'Return to the browser window ↙':request()?'Fill the screen with the room ↗':'How to hide the browser bars';
      button.setAttribute('aria-pressed',String(filled||installed));
    }
    if(filled||installed){if(help)help.hidden=true;if(intro)intro.hidden=true;}
    else if(!request())showHelp(guidance());
    else if(intro){intro.hidden=false;intro.textContent=wasRequested?'You can fill the screen again from Comfort and sound settings.':'Entering asks your browser to fill the screen. You can leave fullscreen at any time.';}
    return filled||installed;
  }
  function fill(){
    if(active()||standalone())return Promise.resolve(true);
    if(pending)return pending;
    const begin=request();
    if(!begin){showHelp(guidance(),true);return Promise.resolve(false);}
    wasRequested=true;
    // Call synchronously, before a recording download or any other await can
    // consume the short-lived browser permission from the entry tap.
    let result;
    try{result=begin();}catch{showHelp(`This browser kept its bars visible. ${guidance()}`,true);return Promise.resolve(false);}
    pending=Promise.resolve(result).then(()=>{sync();return active()||standalone();},()=>{
      showHelp(`This browser kept its bars visible. ${guidance()}`,true);return false;
    }).finally(()=>{pending=null;});
    return pending;
  }
  function enter(){
    // Exiting fullscreen is the visitor's choice; later navigation must never
    // immediately take it back or repeatedly ask the browser for permission.
    if(attemptedEntry)return Promise.resolve(active()||standalone());
    attemptedEntry=true;return fill();
  }
  async function toggle(){
    if(!active())return fill();
    try{
      if(typeof doc.exitFullscreen==='function')await doc.exitFullscreen();
      else if(typeof doc.webkitExitFullscreen==='function')await doc.webkitExitFullscreen();
      sync();return false;
    }catch{announce('The browser kept fullscreen open. You can use its exit control to return to the window.');return true;}
  }
  doc.addEventListener('fullscreenchange',sync);
  doc.addEventListener('webkitfullscreenchange',sync);
  display?.addEventListener?.('change',sync);
  fullDisplay?.addEventListener?.('change',sync);
  sync();
  return {enter,toggle,sync};
}
