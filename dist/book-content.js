export const escapeHTML=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export function inline(s){return escapeHTML(s).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>');}
export function markdown(raw){
  return raw.replace(/^---\s*$/gm,'').split(/\n\s*\n/).map(block=>{
    const s=block.trim();if(!s)return '';
    const h=s.match(/^(#{1,3})\s+(.+)$/);if(h)return `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
    return `<p>${inline(s.replace(/\n/g,' ').replace(/^\*(?!\*)/,''))}</p>`;
  }).join('');
}

export function parseChapter(chapter,raw){
  const blocks=raw.split(/\n(?=#{2,3} )/),first=blocks.shift(),lines=first.split('\n');
  const sourceTitle=lines.shift().replace(/^# /,'');
  const title=chapter.title||sourceTitle;
  const preamble=lines.join('\n').replace(/^\s*\*/,'').replace(/\n---\s*$/,'').trim();
  const common={chapterId:chapter.id,chapterNumber:chapter.number,chapterTitle:title};
  const pages=[{...common,id:`${chapter.id}:title`,title,subtitle:chapter.subtitle||'',body:preamble,titlePage:true}];
  let sectionHeader='';let section=0;
  for(const block of blocks){
    const ls=block.trim().split('\n'),heading=ls.shift().replace(/^#{2,3} /,'');
    const body=ls.join('\n').replace(/\n---\s*$/,'').trim();
    if(!body){sectionHeader=heading;continue;}
    pages.push({...common,id:`${chapter.id}:section-${++section}`,title:heading,body,sectionHeader});sectionHeader='';
  }
  if(pages.length%2)pages.push({...common,id:`${chapter.id}:pause`,title:'A moment between pages.',body:'There is no hurry. Turn the page when you are ready.',endPage:true});
  return pages;
}

export async function loadBook(manifestURL=new URL('./content/book.json',import.meta.url)){
  const response=await fetch(manifestURL);if(!response.ok)throw Error('The book’s contents could not be found.');
  const manifest=await response.json();if(manifest.schema_version!==1||!Array.isArray(manifest.chapters)||!manifest.chapters.length)throw Error('The book’s chapter list is incomplete.');
  const seen=new Set();
  const chapters=await Promise.all(manifest.chapters.map(async chapter=>{
    if(!chapter.id||seen.has(chapter.id)||!Number.isInteger(chapter.number)||chapter.number<1||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.(txt|md)$/.test(chapter.source))throw Error('A chapter has an unreadable address.');
    seen.add(chapter.id);
    const url=new URL(chapter.source,manifestURL),r=await fetch(url);if(!r.ok)throw Error(`Chapter ${chapter.number} could not be opened.`);
    const bytes=await r.arrayBuffer();
    if(chapter.sha256&&globalThis.crypto?.subtle){const digest=await crypto.subtle.digest('SHA-256',bytes);const hash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==chapter.sha256)throw Error(`Chapter ${chapter.number} does not match its saved original.`);}
    return {...chapter,raw:new TextDecoder().decode(bytes),url};
  }));
  const pages=chapters.flatMap(ch=>parseChapter(ch,ch.raw));
  pages.push({id:'unwritten:title',title:'The pages beyond are still unwritten.',body:'This book is still being written. Its author adds a chapter when a truth is ready to be put into words.',endPage:true},{id:'unwritten:rest',title:'You may stay a while.',body:'Return to a chapter, carry its words with you, or close the book. Your place will be waiting.',endPage:true});
  return {manifest,chapters,pages};
}
