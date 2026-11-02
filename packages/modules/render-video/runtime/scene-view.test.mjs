import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import { withBrowserSession } from "./browser-session.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));

test("异步资源失败立即返回原错误，不等待未完成的绘制", async () => {
  const bundle = await build({ stdin: { contents: `
    import React,{useLayoutEffect} from "react";
    import {createViewRenderer,useScene} from "./scene-view.jsx";
    const View=()=>{
      const scene=useScene();
      useLayoutEffect(()=>{
        scene.wait(new Promise(()=>{}));
        queueMicrotask(()=>scene.fail(new Error("地图源加载失败")));
      },[]);
      return <div>待绘制</div>;
    };
    window.inspectFailure=async()=>{
      const renderer=createViewRenderer(View)({element:document.getElementById("root"),
        segment:{visualStyle:{shared:{fonts:{}},p4:{subtitle:{}}}}});
      try{return await Promise.race([renderer.seek(0).then(()=>"错误未返回",error=>error.message),
        new Promise(resolve=>setTimeout(()=>resolve("等待超时"),1500))]);}
      finally{renderer.dispose();}
    };
  `, resolveDir: directory, loader: "jsx" }, bundle: true, write: false, platform: "browser", format: "iife",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  await withBrowserSession(async session => {
    const browser = await session.browser();
    const page = await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    assert.equal(await page.evaluate(()=>window.inspectFailure()),"地图源加载失败");
  });
});
