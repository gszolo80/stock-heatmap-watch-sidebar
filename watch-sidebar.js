// ========== watch-sidebar.js 最终版｜去掉顶部黑条，tooltip板块增加股票数量 ==========
(function(){
  const WATCH_SIDEBAR_STORAGE_KEY = "stock_heatmap_watchlist";
  let wsWatchEchartsIns = null;
  let wsWatchList = [];
  const WS_COLOR_DN  = [26,  152,  80];
  const WS_COLOR_MID = [247, 247,  247];
  const WS_COLOR_UP  = [215,  48,  39];
  const WS_CMAX = 0.055;

  function wsLerpRGB(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }

  function wsChangeToColor(g) {
    const t = Math.max(0, Math.min(1, ((g || 0) / WS_CMAX + 1) / 2));
    const [from, to, u] = t < 0.5 ? [WS_COLOR_DN, WS_COLOR_MID, t * 2] : [WS_COLOR_MID, WS_COLOR_UP, (t - 0.5) * 2];
    const [r, gv, b] = wsLerpRGB(from, to, u);
    return `rgb(${r},${gv},${b})`;
  }

  function wsFmtPct(g){
    if(g==null) return "—";
    const p = g*100;
    return (p>=0?"+":"")+p.toFixed(2)+"%";
  }

  function wsFmtVol(v){
    if(v==null) return "—";
    return v >= 10000 ? (v / 10000).toFixed(2) + " 亿" : v.toFixed(0) + " 万";
  }

  function wsFmtMktcap(v){
    if(v==null) return "—";
    return v >= 10000 ? (v / 10000).toFixed(1) + " 万亿" : v.toFixed(0) + " 亿";
  }

  function wsChgColor(g){
    if(g>0.001) return '#ff4d4f';
    if(g<-0.001) return '#52c41a';
    return '#aaa';
  }

  function wsNormalizeStockCode(rawCode){
    let s = String(rawCode).trim().toUpperCase();
    s = s.replace(/^(SH|SZ)/, "");
    s = s.replace(/[^\d]/g, "");
    return s;
  }

  function wsGetShareObj(){
    return window.__heatmapShare || null;
  }

  function wsInitSidebarDOM(){
    console.log("【自选侧边栏】执行DOM初始化");
    if(document.getElementById("watchSidebar") || document.getElementById("toggleWatchBtn")){
      console.log("【自选侧边栏】DOM已经存在，跳过");
      return;
    }
    const sidebar = document.createElement("div");
    sidebar.id = "watchSidebar";
    let initSidebarWidth = window.innerWidth * 0.5;
    chrome.storage.local.get("WS_SIDEBAR_WIDTH", res=>{
      if(res.WS_SIDEBAR_WIDTH){
        initSidebarWidth = res.WS_SIDEBAR_WIDTH;
      }
      sidebar.style.width = `${initSidebarWidth}px`;
    })
    sidebar.style.width = `${initSidebarWidth}px`;
    sidebar.innerHTML = `
    <div class="watch-head">
      <h3>📌自选股板块视图</h3>
      <input id="watchStockInput" placeholder="输入6位代码，支持SH600036">
      <button id="addWatchStockBtn">添加</button>
      <button id="refreshWatchBtn">刷新视图</button>
      <button class="btn-gray" id="closeWatchSideBtn">关闭</button>
    </div>
    <div class="watch-list-box" id="watchListBox"></div>
    <div id="watchChart"></div>
    <div id="sidebarResizer"></div>
    `;
    document.body.appendChild(sidebar);
    const floatBtn = document.createElement("button");
    floatBtn.id = "toggleWatchBtn";
    floatBtn.innerText = "自选股板块";
    document.body.appendChild(floatBtn);
    const resizer = document.getElementById("sidebarResizer");
    let isDragging = false;
    resizer.addEventListener("mousedown", (e)=>{
      e.preventDefault();
      isDragging = true;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    });
    document.addEventListener("mousemove", (e)=>{
      if(!isDragging) return;
      let newW = window.innerWidth - e.clientX;
      const maxW = window.innerWidth * 0.5;
      const minW = 300;
      newW = Math.max(minW, Math.min(maxW, newW));
      sidebar.style.width = `${newW}px`;
      wsResizeChartContainer();
      if(wsWatchEchartsIns && !wsWatchEchartsIns.isDisposed()){
        wsWatchEchartsIns.resize();
      }
    });
    document.addEventListener("mouseup", ()=>{
      if(!isDragging) return;
      isDragging = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      const finalW = parseInt(sidebar.style.width);
      chrome.storage.local.set({WS_SIDEBAR_WIDTH: finalW});
    });
    floatBtn.addEventListener("click", async ()=>{
      sidebar.classList.toggle("open");
      if(sidebar.classList.contains("open")){
        await wsLoadWatchList();
        wsRenderWatchListUI();
        setTimeout(()=>{
          wsResizeChartContainer();
          wsRenderWatchChartView();
        }, 50);
      }
    });
    document.getElementById("closeWatchSideBtn").addEventListener("click", ()=>{
      sidebar.classList.remove("open");
    });
    document.getElementById("addWatchStockBtn").addEventListener("click", wsAddWatchStock);
    document.getElementById("refreshWatchBtn").addEventListener("click", async ()=>{
      console.log("【自选侧边栏】点击刷新视图");
      await wsLoadWatchList();
      wsRenderWatchListUI();
      wsRenderWatchChartView();
    });
    console.log("【自选侧边栏】✅悬浮按钮DOM创建完成");
  }

  function wsResizeChartContainer(){
    const chartDom = document.getElementById("watchChart");
    const sidebar = document.getElementById("watchSidebar");
    if(!chartDom || !sidebar) return;
    const rect = sidebar.getBoundingClientRect();
    const headH = chartDom.previousElementSibling?.offsetHeight || 210;
    chartDom.style.width = (rect.width - 28) + "px";
    chartDom.style.height = (rect.height - headH - 40) + "px";
  }

  async function wsLoadWatchList(){
    const res = await chrome.storage.local.get(WATCH_SIDEBAR_STORAGE_KEY);
    wsWatchList = res[WATCH_SIDEBAR_STORAGE_KEY] || [];
    wsWatchList = wsWatchList.map(item=>{
      return {
        code:wsNormalizeStockCode(item.code),
        name:item.name
      };
    })
    console.log("【自选侧边栏】读取storage自选列表：", wsWatchList);
    return wsWatchList;
  }

  async function wsSaveWatchList(){
    await chrome.storage.local.set({[WATCH_SIDEBAR_STORAGE_KEY]:wsWatchList});
    wsRenderWatchListUI();
    console.log("【自选侧边栏】已保存自选列表：", wsWatchList);
  }

  function wsRenderWatchListUI(){
    const box = document.getElementById("watchListBox");
    if(!box) return;
    box.innerHTML = "";
    wsWatchList.forEach((item,idx)=>{
      const span = document.createElement("span");
      span.className = "watch-stock-tag";
      span.innerHTML = `${item.name}(${item.code}) <span class="del" data-i="${idx}">×</span>`;
      box.appendChild(span);
    })
    box.querySelectorAll(".del").forEach(el=>{
      el.addEventListener("click", async (e)=>{
        const idx = Number(e.target.dataset.i);
        wsWatchList.splice(idx,1);
        await wsSaveWatchList();
        wsRenderWatchChartView();
      })
    })
  }

  function wsFindStockNameByCode(node, targetCode){
    if(!node.children){
      const rawCode = node.c || node._c;
      const nodeCode = wsNormalizeStockCode(rawCode);
      if(nodeCode === targetCode){
        return node.n || node.name;
      }
      return null;
    }
    for(let child of node.children){
      const name = wsFindStockNameByCode(child, targetCode);
      if(name){
        return name;
      }
    }
    return null;
  }

  async function wsAddWatchStock(){
    const share = wsGetShareObj();
    const inputDom = document.getElementById("watchStockInput");
    let rawInput = inputDom.value.trim();
    if(!rawInput) return;
    const code = wsNormalizeStockCode(rawInput);
    console.log("【自选侧边栏】输入原始值：",rawInput,"标准化后code=",code);
    if(code.length!==6){
      alert("解析失败！请输入6位股票代码，支持SH600036 / SZ000001");
      return;
    }
    await wsLoadWatchList();
    const exist = wsWatchList.find(s=>s.code===code);
    if(exist){
      alert("该股票已经在自选列表");
      return;
    }
    let realName = code;
    if(!share || !share.lastApiData || !share.lastApiData.root){
      alert("⚠️尚未加载行情！请【重新点一键生成】，完成之后再添加股票。");
      realName = `股票${code}`;
    }else{
      const nameFromTree = wsFindStockNameByCode(share.lastApiData.root, code);
      if(nameFromTree){
        realName = nameFromTree;
      }else{
        alert(`警告：代码${code}未在当前行情数据中找到\n请把主页面数量调大一点，重新一键生成。`);
      }
    }
    wsWatchList.push({code:code,name:realName});
    await wsSaveWatchList();
    inputDom.value="";
    await wsRenderWatchChartView();
  }

  function wsCollectTargetSectorNames(root, watchCodeSet){
    const hitSector = new Set();
    for(const sectorNode of root.children || []){
      const sectorName = sectorNode.n;
      function scan(node){
        if(!node.children){
          const c = wsNormalizeStockCode(node.c || node._c);
          return watchCodeSet.has(c);
        }
        for(const child of node.children){
          if(scan(child)) return true;
        }
        return false;
      }
      if(scan(sectorNode)){
        hitSector.add(sectorName);
      }
    }
    return hitSector;
  }

  function wsFilterKeepSectorRawTree(rootClone, targetSectorSet){
    rootClone.children = (rootClone.children||[]).filter(sectorNode=>{
      return targetSectorSet.has(sectorNode.n);
    });
    return rootClone;
  }

  function wsBuildEcHierarchy(node, watchCodeSet, depth=0){
    const isLeaf = !node.children;
    const codeVal = wsNormalizeStockCode(node.c||node._c||"");
    const isWatchStock = watchCodeSet.has(codeVal);
    const gVal = node.g || node._g || 0;
    let itemStyle = {};
    let label = {};
    if(isLeaf){
      itemStyle.color = wsChangeToColor(gVal);
      if(isWatchStock){
        itemStyle.borderColor = "#ffdd00";
        itemStyle.borderWidth = 4;
        label.fontWeight = "bold";
      }else{
        itemStyle.borderColor = "#0d1117";
        itemStyle.borderWidth = 1;
      }
    }else{
      itemStyle.color = depth === 1 ? '#1a2332' : 'transparent';
      itemStyle.borderColor = "#0d1117";
      itemStyle.borderWidth = depth ===1 ?2:1;
    }
    const ecNode = {
      name: node.n || node.name || "未知板块",
      value: node.v || node.value,
      _g: node.g || node._g || 0,
      _c: node.c || node._c,
      _hover: node._hover || "",
      _vol: node.vol || node._vol || 0,
      _mktcap: node.mktcap || node._mktcap ||0,
      _float: node.float_cap || node._float ||0,
      price: node.price || null,
      itemStyle,
      label
    };
    if(!isLeaf && node.children){
      ecNode.children = node.children.map(child=>wsBuildEcHierarchy(child,watchCodeSet,depth+1));
    }
    return ecNode;
  }

  // 统计树节点叶子股票数量，写入 _stockCount
  function wsCountLeafStock(node){
    if(!node.children || node.children.length===0){
      return 1;
    }
    let cnt = 0;
    for(const child of node.children){
      cnt += wsCountLeafStock(child);
    }
    node._stockCount = cnt;
    return cnt;
  }

  function wsApplySidebarOption(baseOpt){
    if(!baseOpt || !baseOpt.series || !baseOpt.series[0]) return baseOpt;

    baseOpt.grid = {left:10,right:10,top:10,bottom:10,containLabel:true};
    baseOpt.series[0].left = 10;
    baseOpt.series[0].right = 10;
    baseOpt.series[0].top = 10;
    baseOpt.series[0].bottom = 10;

    baseOpt.tooltip = {
      confine: true,
      show: true,
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: '#d0d7de',
      borderWidth: 1,
      padding: [2, 4],
      textStyle: {
        color: '#1f2328',
        fontSize: 12,
        fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',
        lineHeight: 18
      },
      position: function(point, params, dom, rect, size) {
        let x = point[0];
        let y = point[1];
        const tooltipHeight = size.contentSize[1];
        const chartTop = 10;
        if(y - tooltipHeight < chartTop){
          y = point[1] + 8;
        }else{
          y = point[1] - tooltipHeight - 4;
        }
        return [x, y];
      },
      formatter: function(params){
        const d = params.data;
        if(!d) return "";
        // 板块父节点，增加股票数量
        if(d.children){
          const stockCnt = d._stockCount || 0;
          return `<div style="font-weight:bold;color:#0969da;margin-bottom:6px">${d.name}</div>` +
                 `<div>涨跌幅：<span style="color:${wsChgColor(d._g)};font-weight:bold">${wsFmtPct(d._g)}</span></div>`+
                 `<div>股票数量：${stockCnt} 只</div>`;
        }
        // 股票叶子节点
        return `<div style="font-weight:bold;color:#0969da;margin-bottom:6px">${d.name}（${d._c}）</div>` +
               `<div>涨跌幅：<span style="color:${wsChgColor(d._g)};font-weight:bold">${wsFmtPct(d._g)}</span></div>` +
               `<div>成交额：${wsFmtVol(d._vol)}</div>` +
               `<div>总市值：${wsFmtMktcap(d._mktcap)}</div>` +
               `<div>流通市值：${wsFmtMktcap(d._float)}</div>`;
      }
    };

    return baseOpt;
  }

  async function wsRenderWatchChartView(){
    const share = wsGetShareObj();
    const chartDom = document.getElementById("watchChart");
    if(!chartDom) return;
    console.log("【自选侧边栏】执行渲染，当前wsWatchList=",wsWatchList);
    if(!share || !share.lastApiData || !share.lastApiData.root){
      chartDom.innerHTML = `<div class="tip-text">⚠️ 请点击主页面【一键生成】加载行情数据</div>`;
      if(wsWatchEchartsIns){
        wsWatchEchartsIns.dispose();
        wsWatchEchartsIns = null;
      }
      return;
    }
    if(!share.sizeBy || !share.SIZE_INFO || !share.ensureECharts){
      chartDom.innerHTML = `<div class="tip-text">⚠️共享接口未就绪，请刷新页面，重新一键生成</div>`;
      return;
    }
    if(wsWatchList.length === 0){
      chartDom.innerHTML = `<div class="tip-text">📝 请输入6位股票代码添加自选股</div>`;
      if(wsWatchEchartsIns){
        wsWatchEchartsIns.dispose();
        wsWatchEchartsIns = null;
      }
      return;
    }
    try{
      await share.ensureECharts();
      const watchCodeSet = new Set(wsWatchList.map(s=>String(s.code)));
      console.log("【自选侧边栏】待匹配股票代码集合",watchCodeSet);
      const rawRootClone = JSON.parse(JSON.stringify(share.lastApiData.root));
      const targetSectorSet = wsCollectTargetSectorNames(rawRootClone, watchCodeSet);
      console.log("【自选侧边栏】命中板块名称：", targetSectorSet);
      if(targetSectorSet.size === 0){
        const missCodes = wsWatchList.map(s=>s.code).join("、");
        if(wsWatchEchartsIns){
          wsWatchEchartsIns.dispose();
          wsWatchEchartsIns = null;
        }
        chartDom.innerHTML = `<div class="tip-text">❌在当前行情数据集找不到自选股：${missCodes}<br>请把主页面顶部数量调大，重新一键生成。</div>`;
        return;
      }
      const filteredRawTree = wsFilterKeepSectorRawTree(rawRootClone, targetSectorSet);
      filteredRawTree.depth = 0;
      const virtualRoot = {
        name: "自选板块汇总",
        children: filteredRawTree.children
      };
      const customEcRoot = wsBuildEcHierarchy(virtualRoot, watchCodeSet,0);
      // 预先统计全部板块下股票数量
      wsCountLeafStock(customEcRoot);

      if(customEcRoot.children && customEcRoot.children.length>0){
        customEcRoot.children.forEach(sectorNode=>{
          sectorNode.value = 1;
        })
      }
      if(wsWatchEchartsIns && !wsWatchEchartsIns.isDisposed()){
          wsWatchEchartsIns.dispose();
      }
      wsResizeChartContainer();
      wsWatchEchartsIns = echarts.init(chartDom,null,{renderer:"canvas"});
      const option = {
        backgroundColor:"#0d1117",
        series:[{
          type:"treemap",
          width:"100%",
          height:"100%",
          roam:true,
          nodeClick:"zoomToNode",
          squareRatio:0.5*(1+Math.sqrt(5)),
          visibleMin:150,
          top:10,left:10,right:10,bottom:10,
          label:{
            show:true,
            overflow:"truncate",
            ellipsis:"…",
            formatter:function(p){
              const d = p.data;
              if(!d) return '';
              let fs = 11;
              if(p.rect){
                const w = p.rect.width;
                const h = p.rect.height;
                const s = Math.min(w,h);
                fs = Math.max(7, Math.min(14, Math.round(s * 0.175)));
              }
              const light = Math.abs(d._g||0)<0.02;
              return light
                ?`{nm_dk_${fs}|${d.name}}\n{pc_dk_${fs}|${wsFmtPct(d._g)}}`
                :`{nm_lt_${fs}|${d.name}}\n{pc_lt_${fs}|${wsFmtPct(d._g)}}`;
            },
            rich:{
              nm_dk_7:{fontSize:7,fontWeight:"bold",color:"#000000",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(7*1.35)},
              nm_dk_8:{fontSize:8,fontWeight:"bold",color:"#000000",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(8*1.35)},
              nm_dk_9:{fontSize:9,fontWeight:"bold",color:"#000000",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(9*1.35)},
              nm_dk_10:{fontSize:10,fontWeight:"bold",color:"#000000",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(10*1.35)},
              nm_dk_11:{fontSize:11,fontWeight:"bold",color:"#000000",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(11*1.35)},
              nm_dk_12:{fontSize:12,fontWeight:"bold",color:"#000000",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(12*1.35)},
              nm_dk_13:{fontSize:13,fontWeight:"bold",color:"#000000",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(13*1.35)},
              nm_dk_14:{fontSize:14,fontWeight:"bold",color:"#000000",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(14*1.35)},

              pc_dk_7:{fontSize:6,color:"#000000",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(6*1.35)},
              pc_dk_8:{fontSize:7,color:"#000000",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(7*1.35)},
              pc_dk_9:{fontSize:8,color:"#000000",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(8*1.35)},
              pc_dk_10:{fontSize:9,color:"#000000",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(9*1.35)},
              pc_dk_11:{fontSize:10,color:"#000000",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(10*1.35)},
              pc_dk_12:{fontSize:11,color:"#000000",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(11*1.35)},
              pc_dk_13:{fontSize:12,color:"#000000",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(12*1.35)},
              pc_dk_14:{fontSize:13,color:"#000000",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(13*1.35)},

              nm_lt_7:{fontSize:7,fontWeight:"bold",color:"#f0f6fc",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(7*1.35)},
              nm_lt_8:{fontSize:8,fontWeight:"bold",color:"#f0f6fc",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(8*1.35)},
              nm_lt_9:{fontSize:9,fontWeight:"bold",color:"#f0f6fc",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(9*1.35)},
              nm_lt_10:{fontSize:10,fontWeight:"bold",color:"#f0f6fc",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(10*1.35)},
              nm_lt_11:{fontSize:11,fontWeight:"bold",color:"#f0f6fc",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(11*1.35)},
              nm_lt_12:{fontSize:12,fontWeight:"bold",color:"#f0f6fc",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(12*1.35)},
              nm_lt_13:{fontSize:13,fontWeight:"bold",color:"#f0f6fc",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(13*1.35)},
              nm_lt_14:{fontSize:14,fontWeight:"bold",color:"#f0f6fc",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(14*1.35)},

              pc_lt_7:{fontSize:6,color:"rgba(255,255,255,0.82)",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(6*1.35)},
              pc_lt_8:{fontSize:7,color:"rgba(255,255,255,0.82)",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(7*1.35)},
              pc_lt_9:{fontSize:8,color:"rgba(255,255,255,0.82)",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(8*1.35)},
              pc_lt_10:{fontSize:9,color:"rgba(255,255,255,0.82)",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(9*1.35)},
              pc_lt_11:{fontSize:10,color:"rgba(255,255,255,0.82)",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(10*1.35)},
              pc_lt_12:{fontSize:11,color:"rgba(255,255,255,0.82)",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(11*1.35)},
              pc_lt_13:{fontSize:12,color:"rgba(255,255,255,0.82)",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(12*1.35)},
              pc_lt_14:{fontSize:13,color:"rgba(255,255,255,0.82)",fontFamily:'"Microsoft YaHei","SimHei","PingFang SC","Helvetica Neue",sans-serif',lineHeight:Math.round(13*1.35)}
            }
          },
          upperLabel:{
            show:false
          },
          emphasis:{
            label:{show:true},
            upperLabel:{show:false},
            itemStyle:{borderColor:"#58a6ff",borderWidth:2}
          },
          breadcrumb:{
            show:false,
            bottom:4,height:20,emptyItemWidth:20,
            itemStyle:{color:"#21262d",borderColor:"#30363d",textStyle:{color:"#8b949e",fontSize:11}}
          },
          data:[customEcRoot]
        }]
      };
      wsApplySidebarOption(option);
      wsWatchEchartsIns.setOption(option,{notMerge:true});
      wsWatchEchartsIns.resize();
      console.log("【自选侧边栏】✅渲染完成");
    }catch(err){
      console.error("【自选侧边栏渲染异常】",err);
      chartDom.innerHTML = `<div class="tip-text">❌渲染出错：${err.message}<br>请先点击一键生成，加载完整行情</div>`;
      if(wsWatchEchartsIns){
        wsWatchEchartsIns.dispose();
        wsWatchEchartsIns=null;
      }
    }
  }

  function wsOnResize(){
    wsResizeChartContainer();
    if(wsWatchEchartsIns && !wsWatchEchartsIns.isDisposed()){
      wsWatchEchartsIns.resize();
    }
  }

  document.addEventListener("DOMContentLoaded", ()=>{
    console.log("【自选侧边栏】DOMContentLoaded触发，开始初始化UI");
    wsInitSidebarDOM();
    window.addEventListener("resize", wsOnResize);
  });
})();
