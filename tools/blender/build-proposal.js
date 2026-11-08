const {chromium}=require('playwright');const fs=require('fs');const {execSync}=require('child_process');
const P=process.argv[2];const src=fs.readFileSync(P+'/proposal.html','utf8');
const titles=fs.readFileSync(P+'/titles.txt','utf8').trim().split('\n').map(l=>l.split('\t')[1].replace(' ESTIMATE','').trim());
async function render(html,out){fs.writeFileSync(P+'/_build.html',html);const b=await chromium.launch();const p=await b.newPage();
await p.goto('file://'+P+'/_build.html',{waitUntil:'networkidle'});await p.pdf({path:out,format:'A4',printBackground:true,preferCSSPageSize:true});await b.close();}
(async()=>{const tmp=P+'/_pass1.pdf';await render(src.replace(/@@P[A-Z0-9]+@@/g,'00').replace(/<h2([^>]*)><span class="n">(\d+)<\/span>/g,(m,a,d)=>`<h2${a}><i style="font-size:2px;color:#fff">QQH${d}QQ</i><span class="n">${d}</span>`).replace('>Appendix A','><i style="font-size:2px;color:#fff">QQAPPQQ</i>Appendix A'),tmp);
const n=+execSync(`pdfinfo ${tmp}`).toString().match(/Pages:\s+(\d+)/)[1];const pages=[];
for(let i=1;i<=n;i++)pages.push(execSync(`pdftotext -f ${i} -l ${i} -layout ${tmp} -`).toString().replace(/\s+/g,' '));
const toc=pages.findIndex(t=>t.includes('Contents'));const map={};
titles.forEach((t,i)=>{const k='QQH'+(i+1)+'QQ';const pg=pages.findIndex((x,j)=>j>=toc&&x.includes(k));map['P'+(i+1)]=pg+1;if(pg<0)console.log('MISSING',t);});
map.PAPP=pages.findIndex((x,j)=>j>=toc&&x.includes('QQAPPQQ'))+1;console.log(JSON.stringify(map),'pages',n);
await render(src.replace(/@@(P[A-Z0-9]+)@@/g,(_,k)=>String(map[k])),P+'/NULL-TECH-Circuit-Studio-Proposal.pdf');fs.unlinkSync(tmp);fs.unlinkSync(P+'/_build.html');})();
