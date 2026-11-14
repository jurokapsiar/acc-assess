// Client-side script, embedded inline. Plain ES5-ish, no template literals.
export const CLIENT_JS = String.raw`
(function(){
  var d=document;d.documentElement.className=d.documentElement.className.replace('no-js','js');

  // nav: aria-current for the section in view
  var links=[].slice.call(d.querySelectorAll('.top nav a[href^="#"]'));
  var byId={};links.forEach(function(a){byId[a.getAttribute('href').slice(1)]=a;});
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){
      es.forEach(function(e){
        if(!e.isIntersecting)return;
        links.forEach(function(a){a.removeAttribute('aria-current');});
        var a=byId[e.target.id];if(a)a.setAttribute('aria-current','true');
      });
    },{rootMargin:'-45% 0px -50% 0px'});
    Object.keys(byId).forEach(function(id){var s=d.getElementById(id);if(s)io.observe(s);});
    var rv=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');rv.unobserve(e.target);}});},{rootMargin:'0px 0px -8% 0px'});
    [].forEach.call(d.querySelectorAll('.reveal'),function(el){rv.observe(el);});
  } else {
    [].forEach.call(d.querySelectorAll('.reveal'),function(el){el.classList.add('in');});
  }

  // tabs (roving tabindex, automatic activation)
  var tabs=[].slice.call(d.querySelectorAll('.tabs [role=tab]'));
  function select(t,focus){
    tabs.forEach(function(x){
      var on=x===t;x.setAttribute('aria-selected',on?'true':'false');x.tabIndex=on?0:-1;
      d.getElementById(x.getAttribute('aria-controls')).hidden=!on;
    });
    if(focus)t.focus();
    apply();
  }
  tabs.forEach(function(t,i){
    t.addEventListener('click',function(){select(t,false);});
    t.addEventListener('keydown',function(e){
      var n=null;
      if(e.key==='ArrowRight')n=tabs[(i+1)%tabs.length];
      else if(e.key==='ArrowLeft')n=tabs[(i-1+tabs.length)%tabs.length];
      else if(e.key==='Home')n=tabs[0];
      else if(e.key==='End')n=tabs[tabs.length-1];
      if(n){e.preventDefault();select(n,true);}
    });
  });

  // filters
  var q=d.getElementById('f-q'),lv=d.getElementById('f-level'),pr=d.getElementById('f-principle');
  var tb=[].slice.call(d.querySelectorAll('.toolbtns button'));
  var out=d.getElementById('f-count'),reset=d.getElementById('f-reset');
  function has(list,v){return (' '+list+' ').indexOf(' '+v+' ')>-1;}
  function apply(){
    if(!q)return;
    var panel=d.querySelector('.panel:not([hidden])');if(!panel)return;
    var kind=panel.getAttribute('data-kind');
    var text=q.value.trim().toLowerCase(),L=lv.value,P=pr.value;
    var T=tb.filter(function(b){return b.getAttribute('aria-pressed')==='true';}).map(function(b){return b.getAttribute('data-tool');});
    var rows=[].slice.call(panel.querySelectorAll('tbody tr')),shown=0;
    rows.forEach(function(r){
      var ok=true;
      if(text&&r.getAttribute('data-search').indexOf(text)<0)ok=false;
      if(ok&&kind!=='apg'&&L&&!has(r.getAttribute('data-levels'),L))ok=false;
      if(ok&&kind!=='apg'&&P&&!has(r.getAttribute('data-principles'),P))ok=false;
      if(ok&&T.length&&!T.some(function(t){return has(r.getAttribute('data-tools'),t);}))ok=false;
      r.hidden=!ok;if(ok)shown++;
    });
    panel.querySelector('.empty').hidden=shown>0;
    var noun=panel.getAttribute('data-noun');
    var msg='Showing '+shown+' of '+rows.length+' '+noun+'.';
    if(kind==='apg'&&(L||P))msg+=' Level and principle filters do not apply to patterns.';
    out.textContent=msg;
  }
  if(q){
    q.addEventListener('input',apply);lv.addEventListener('change',apply);pr.addEventListener('change',apply);
    tb.forEach(function(b){b.addEventListener('click',function(){b.setAttribute('aria-pressed',b.getAttribute('aria-pressed')==='true'?'false':'true');apply();});});
    reset.addEventListener('click',function(){q.value='';lv.value='';pr.value='';tb.forEach(function(b){b.setAttribute('aria-pressed','false');});apply();q.focus();});
    d.getElementById('filters').hidden=false;
    apply();
  }
})();
`;
