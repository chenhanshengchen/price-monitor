function (element, input) {
    try {
        // 第一步：穿透沙盒环境，强行从页面的真实 window 中获取数据
        // 1. 在页面上创建一个隐藏的临时标签
        var tempDiv = document.createElement('div');
        tempDiv.id = 'shadowbot_temp_data_div';
        tempDiv.style.display = 'none';
        document.body.appendChild(tempDiv);

        // 2. 向页面注入一段真实环境运行的 script，把数据塞进临时标签里
        var injectScript = document.createElement('script');
        injectScript.textContent = "document.getElementById('shadowbot_temp_data_div').innerText = JSON.stringify(window.__ICE_APP_CONTEXT__ || {});";
        document.body.appendChild(injectScript);

        // 3. 影刀的沙盒环境去读取这个临时标签里的内容
        var dataStr = tempDiv.innerText;

        // 4. 打扫战场，删掉临时标签，做到无痕
        document.body.removeChild(injectScript);
        document.body.removeChild(tempDiv);

        // 如果拿出来的是空的，说明确实没加载完
        if (!dataStr || dataStr === "{}" || dataStr === "") {
            return "提取失败: 页面数据未加载或网页结构变更。建议在执行脚本前加一个[强制等待]3秒。";
        }

        // 把字符串转回对象
        var ctx = JSON.parse(dataStr);

        // 第二步：开始正常解析数据
        if (!ctx.loaderData || !ctx.loaderData.home || !ctx.loaderData.home.data || !ctx.loaderData.home.data.res) {
            return "提取失败: 拿到了数据，但数据结构中找不到 loaderData.home.data.res";
        }

        var res = ctx.loaderData.home.data.res;
        var skuBase = res.skuBase;
        var skuCore = res.skuCore;

        if (!skuCore || !skuCore.sku2info) {
            return "提取失败: 数据结构中找不到 skuCore.sku2info";
        }

        // 只取 skuBase.props 的前两个分类组：第一组为 A，第二组为 B，第三组及以后忽略
        // 前提：skuBase.props 的顺序与页面从上到下的分类顺序一致（需现场核对）
        var props = (skuBase && skuBase.props) ? skuBase.props : [];
        var groupA = props[0] || null;
        var groupB = props[1] || null;

        if (!groupA) {
            return "提取失败: skuBase.props 为空，无法确定分类 A";
        }

        // 按 vid 建立选项字典（分类名、选项文本分开保存，不拼接）
        function buildValueMap(group) {
            var map = {};
            if (group && group.values) {
                for (var i = 0; i < group.values.length; i++) {
                    var v = group.values[i];
                    map[String(v.vid)] = v.name;
                }
            }
            return map;
        }
        var pidA = String(groupA.pid);
        var pidB = groupB ? String(groupB.pid) : null;
        var valuesA = buildValueMap(groupA);
        var valuesB = buildValueMap(groupB);

        // 结构错误（属性引用无法解析等），不归为"未知规格"
        var errors = [];

        // 解析每个真实 skuId 的 propPath，按 pid 找 A、B，不依赖 propPath 段顺序
        var skuSpecMap = {};
        var baseSkus = (skuBase && skuBase.skus) ? skuBase.skus : [];
        for (var k = 0; k < baseSkus.length; k++) {
            var s = baseSkus[k];
            var sid = String(s.skuId);
            var pidToVid = {};
            var paths = s.propPath ? s.propPath.split(';') : [];
            for (var m = 0; m < paths.length; m++) {
                var idx = paths[m].indexOf(':');
                if (idx > 0) {
                    pidToVid[paths[m].substring(0, idx)] = paths[m].substring(idx + 1);
                }
            }

            var vidA = pidToVid[pidA];
            if (vidA === undefined) {
                errors.push({ skuId: sid, propPath: s.propPath || "", reason: "propPath 中缺少分类 A (pid=" + pidA + ")" });
                continue;
            }
            if (!valuesA.hasOwnProperty(vidA)) {
                errors.push({ skuId: sid, propPath: s.propPath || "", reason: "分类 A 选项无法解析 (" + pidA + ":" + vidA + ")" });
                continue;
            }

            // B 缺失（商品只有一组分类，或该 SKU 无 B）沿用 B 为空
            var vidB = pidB !== null ? pidToVid[pidB] : undefined;
            if (vidB !== undefined && !valuesB.hasOwnProperty(vidB)) {
                errors.push({ skuId: sid, propPath: s.propPath || "", reason: "分类 B 选项无法解析 (" + pidB + ":" + vidB + ")" });
                continue;
            }

            skuSpecMap[sid] = {
                a: valuesA[vidA],
                b: vidB !== undefined ? valuesB[vidB] : "",
                // 内部去重键：结构化数组序列化，不受选项文本中的 | 等字符干扰
                key: JSON.stringify([pidA, vidA, pidB, vidB === undefined ? null : vidB])
            };
        }

        // 遍历 sku2info 提取价格，按 A+B 合并；价格冲突时记录而不是覆盖
        var tempMap = {};
        var tempOrder = [];
        var conflicts = [];
        var rawSkuCount = 0;
        var skus = skuCore.sku2info;

        for (var skuId in skus) {
            if (skuId === "0") continue;
            rawSkuCount++;

            var info = skus[skuId];
            var spec = skuSpecMap[skuId];
            if (!spec) {
                // 已在上面记录过解析错误的不重复记录
                var known = false;
                for (var e = 0; e < errors.length; e++) {
                    if (errors[e].skuId === skuId) { known = true; break; }
                }
                if (!known) {
                    errors.push({ skuId: skuId, propPath: "", reason: "skuBase.skus 中找不到该 skuId" });
                }
                continue;
            }

            var rawPrice = "未知";
            if (info.price) {
                rawPrice = info.price.priceText || (info.price.priceMoney ? (parseInt(info.price.priceMoney) / 100).toFixed(2) : "未知");
            }

            var subPriceStr = "";
            if (info.subPrice && info.subPrice.priceText) {
                subPriceStr = info.subPrice.priceText;
            }

            var existing = tempMap[spec.key];
            if (!existing) {
                tempMap[spec.key] = {
                    "镜片套餐": spec.a,
                    "折射率": spec.b,
                    "日常价": rawPrice,
                    "活动价": subPriceStr,
                    skuIds: [skuId]
                };
                tempOrder.push(spec.key);
            } else if (existing["日常价"] === rawPrice && existing["活动价"] === subPriceStr) {
                existing.skuIds.push(skuId);
            } else {
                conflicts.push({
                    "镜片套餐": spec.a,
                    "折射率": spec.b,
                    existing: { skuIds: existing.skuIds.slice(), "日常价": existing["日常价"], "活动价": existing["活动价"] },
                    incoming: { skuId: skuId, "日常价": rawPrice, "活动价": subPriceStr }
                });
            }
        }

        var resultList = [];
        for (var t = 0; t < tempOrder.length; t++) {
            var item = tempMap[tempOrder[t]];
            resultList.push({
                "镜片套餐": item["镜片套餐"],
                "折射率": item["折射率"],
                "日常价": item["日常价"],
                "活动价": item["活动价"]
            });
        }

        // 排序：先按镜片套餐文本长度升序，再按镜片套餐文本字典序，最后按折射率数字升序
        resultList.sort(function(a, b) {
            var lenA = a["镜片套餐"].length;
            var lenB = b["镜片套餐"].length;

            // 第一层：按镜片套餐文本长度升序
            if (lenA !== lenB) {
                return lenA - lenB;
            }

            // 第二层：长度相同时按镜片套餐文本字典序
            if (a["镜片套餐"] !== b["镜片套餐"]) {
                if (a["镜片套餐"] < b["镜片套餐"]) return -1;
                if (a["镜片套餐"] > b["镜片套餐"]) return 1;
            }

            // 第三层：镜片套餐相同时，按折射率中的数字升序
            var numA = parseFloat(a["折射率"].match(/[\d.]+/));
            var numB = parseFloat(b["折射率"].match(/[\d.]+/));

            if (isNaN(numA) && isNaN(numB)) return 0;
            if (isNaN(numA)) return 1;  // 无数字的排后面
            if (isNaN(numB)) return -1;

            return numA - numB;  // 按数字升序
        });

        // 店铺名：主位置 seller.shopName，备用 componentsVO.storeCardVO.shopName
        // 读取出错只返回空字符串，不影响 SKU 和价格
        function readShopName() {
            try {
                var name = res.seller && res.seller.shopName;
                if (!name && res.componentsVO && res.componentsVO.storeCardVO) {
                    name = res.componentsVO.storeCardVO.shopName;
                }
                return name ? String(name).trim() : "";
            } catch (err) {
                return "";
            }
        }

        // 货号：按名称"货号"查找，不按位置取（不同商品参数顺序不同）
        // 主位置 plusViewVO.industryParamVO.basicParamList，备用 componentsVO.extensionInfoVO.infos[*].items[*]
        function readArticleNumber() {
            try {
                var basic = res.plusViewVO && res.plusViewVO.industryParamVO && res.plusViewVO.industryParamVO.basicParamList;
                if (basic) {
                    for (var i = 0; i < basic.length; i++) {
                        if (basic[i] && basic[i].propertyName === "货号" && basic[i].valueName) {
                            return String(basic[i].valueName).trim();
                        }
                    }
                }
                var infos = res.componentsVO && res.componentsVO.extensionInfoVO && res.componentsVO.extensionInfoVO.infos;
                if (infos) {
                    for (var j = 0; j < infos.length; j++) {
                        var items = infos[j] && infos[j].items;
                        if (!items) continue;
                        for (var n = 0; n < items.length; n++) {
                            if (items[n] && items[n].title === "货号" && items[n].text && items[n].text[0]) {
                                return String(items[n].text[0]).trim();
                            }
                        }
                    }
                }
                return "";
            } catch (err) {
                return "";
            }
        }

        // 返回新格式，包含商品信息和 SKU 数组
        // categoryNames/stats/conflicts/errors 为独立字段，不混入 skus
        // conflicts 或 errors 非空表示校验失败，Python 和 Node.js 会拒绝导入
        return {
            itemId: res.item && res.item.itemId ? String(res.item.itemId) : "",
            title: res.item && res.item.title ? res.item.title : "",
            url: window.location.href,
            shopName: readShopName(),
            articleNumber: readArticleNumber(),
            categoryNames: {
                A: groupA.name || "",
                B: groupB ? (groupB.name || "") : ""
            },
            stats: {
                propsCount: props.length,
                rawSkuCount: rawSkuCount,
                mergedCount: resultList.length,
                conflictCount: conflicts.length,
                errorCount: errors.length
            },
            conflicts: conflicts,
            errors: errors,
            skus: resultList
        };

    } catch (e) {
        return "提取时发生异常报错: " + e.message;
    }
}
