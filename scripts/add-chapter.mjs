import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';

const [source,title,...extra]=process.argv.slice(2);
if(!source||!title||extra.length){console.error('Use: node scripts/add-chapter.mjs /absolute/path/to/chapter.txt "Chapter title"');process.exit(1);}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const content=path.join(root,'dist','content'),manifestPath=path.join(content,'book.json');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const bytes=readFileSync(path.resolve(source));
if(!bytes.length||!/^#\s+.+/m.test(bytes.toString('utf8'))){console.error('The chapter needs a # title and some text. The book was not changed.');process.exit(1);}
const number=Math.max(...manifest.chapters.map(c=>c.number))+1;
const slug=title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70);
if(!slug){console.error('Give the chapter a title with letters or numbers.');process.exit(1);}
const filename=`chapter-${String(number).padStart(2,'0')}-${slug}.txt`,destination=path.join(content,filename);
if(existsSync(destination)||manifest.chapters.some(c=>c.id===slug)){console.error('A chapter with that name already exists. Nothing was overwritten.');process.exit(1);}
const entry={id:slug,number,title,source:filename,sha256:createHash('sha256').update(bytes).digest('hex')};
mkdirSync(content,{recursive:true});writeFileSync(destination,bytes,{flag:'wx'});
manifest.chapters.push(entry);
const temporary=manifestPath+'.tmp';writeFileSync(temporary,JSON.stringify(manifest,null,2)+'\n');renameSync(temporary,manifestPath);
const index=path.join(root,'dist','llms.txt');
writeFileSync(index,readFileSync(index,'utf8')+`\n- [Chapter ${number}: ${title.replace(/[\[\]\r\n]/g,' ')}](content/${filename}): author-supplied chapter.\n`);
console.log(`Chapter ${number}, “${title}”, was added with its original wording. Preview the book, then publish the updated Site.`);
