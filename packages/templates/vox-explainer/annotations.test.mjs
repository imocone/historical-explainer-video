import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import {hyperframesCli, hyperframesEnv} from '../../modules/render-video/runtime/browser-session.mjs';
import {annotationTools, measureText, mark, arrow} from './annotations.mjs';

test('从临时目录测量工作单的相对字体路径', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'vox-font-'));
  const options = {fontFile:'packages/templates/vox-explainer/fonts/NotoSansSC-Medium.ttf', lines:['过河'], fontSize:48};
  try {
    const source = `import {measureText} from ${JSON.stringify(new URL('./annotations.mjs', import.meta.url).href)};
      console.log(JSON.stringify(measureText(${JSON.stringify(options)})));`;
    const result = execFileSync(process.execPath, ['--input-type=module','-e',source], {cwd:directory, encoding:'utf8'});
    assert.deepEqual(JSON.parse(result), measureText(options));
  } finally { await rm(directory, {recursive:true, force:true}); }
});

test('裁图锚点与字框跨SVG视口时仍指向同一处', async () => {
  const executablePath = execFileSync(process.execPath, [hyperframesCli,'browser','path'], {env:hyperframesEnv, encoding:'utf8'}).trim();
  const browser = await puppeteer.launch({executablePath, headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent(`<svg id="canvas" width="390" height="219.375" viewBox="0 0 1920 1080">
      <g id="part" transform="translate(480 320)">
        <svg width="240" height="160" viewBox="80 60 600 400">
          <rect id="content" x="80" y="60" width="600" height="400"/>
        </svg>
      </g></svg>`);
    const result = await page.evaluate(source => {
      const svg = document.querySelector('#canvas'), part = document.querySelector('#part'), content = document.querySelector('#content');
      const pen = new Function(`return (${source})`)()(svg);
      return {point:pen.point(content,80,60), bounds:pen.bounds(content), local:pen.point(content,80,60,part)};
    }, annotationTools.toString());
    const near = (actual, expected) => assert.ok(Math.abs(actual-expected)<1e-6, `${actual} != ${expected}`);
    result.point.forEach((v,i)=>near(v,[480,320][i]));
    result.local.forEach(v=>near(v,0));
    Object.entries({x:480,y:320,width:240,height:160}).forEach(([key,value])=>near(result.bounds[key],value));
  } finally { await browser.close(); }
});

test('有底边的墨线按进度显露，回跳不留线身或箭尖', async () => {
  const executablePath = execFileSync(process.execPath, [hyperframesCli,'browser','path'], {env:hyperframesEnv, encoding:'utf8'}).trim();
  const browser = await puppeteer.launch({executablePath, headless:true});
  try {
    const page = await browser.newPage();
    await page.setViewport({width:500,height:230,deviceScaleFactor:1});
    await page.setContent(`<style>body{margin:0;background:white}svg{--paper:#eee6d2;--accent:#963c23}</style>
      <svg id="canvas" width="500" height="230">
        ${mark({id:'ring',kind:'circle',box:{x:70,y:45,width:200,height:60}})}
        ${arrow({id:'pointer',from:[45,175],to:[430,175]})}
      </svg>`);
    await page.evaluate(source => {
      window.pen = new Function(`return (${source})`)()(document.querySelector('#canvas'));
    }, annotationTools.toString());
    const frame = async progress => {
      await page.evaluate(progress => {
        for (const id of ['ring','pointer']) window.pen.draw(document.getElementById(id),progress);
      },progress);
      return Buffer.from(await page.screenshot());
    };
    const inkPixels = async png => {
      const {data,info}=await sharp(png).removeAlpha().raw().toBuffer({resolveWithObject:true});
      let count=0;
      for(let i=0;i<data.length;i+=info.channels) if(data[i]<200 && data[i+1]<170 && data[i+2]<150) count++;
      return count;
    };
    const empty=await frame(0), partial=await frame(.4), full=await frame(1);
    assert.equal(await inkPixels(empty),0);
    assert.ok(await inkPixels(partial)>100,'中途必须已经画出真实笔迹');
    assert.ok(await inkPixels(full)>await inkPixels(partial),'完成态必须显露剩余笔迹与箭尖');
    assert.deepEqual(await frame(.4),partial,'回跳到同一时刻须恢复同一画面');
    assert.deepEqual(await frame(0),empty,'回到开头不得残留箭尖或底边');
  } finally { await browser.close(); }
});
