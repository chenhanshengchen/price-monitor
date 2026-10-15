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

        // 建立规格属性字典
        var propMap = {};
        if (skuBase && skuBase.props) {
            for (var i = 0; i < skuBase.props.length; i++) {
                var p = skuBase.props[i];
                if (p.values) {
                    for (var j = 0; j < p.values.length; j++) {
                        var v = p.values[j];
                        propMap[p.pid + ":" + v.vid] = p.name + ":" + v.name;
                    }
                }
            }
        }

        // 将 SKU ID 和中文规格名对应起来
        var skuNameMap = {};
        if (skuBase && skuBase.skus) {
            for (var k = 0; k < skuBase.skus.length; k++) {
                var s = skuBase.skus[k];
                if (s.propPath) {
                    var paths = s.propPath.split(';');
                    var names = [];
                    for (var m = 0; m < paths.length; m++) {
                        if (propMap[paths[m]]) {
                            names.push(propMap[paths[m]]);
                        }
                    }
                    skuNameMap[s.skuId] = names.join(' | ');
                }
            }
        }

        // 遍历 sku2info 提取价格并存入临时对象（用于去重）
        var tempMap = {};
        var skus = skuCore.sku2info;

        for (var skuId in skus) {
            if (skuId === "0") continue;

            var info = skus[skuId];
            var name = skuNameMap[skuId] || "未知规格";

            // 删除"镜片适合度数:x度以内"这段内容（使用正则匹配）
            name = name.replace(/\s*\|\s*镜片适合度数:[^\|]*$/g, '').replace(/镜片适合度数:[^\|]*\s*\|\s*/g, '').trim();

            var rawPrice = "未知";
            if (info.price) {
                rawPrice = info.price.priceText || (info.price.priceMoney ? (parseInt(info.price.priceMoney) / 100).toFixed(2) : "未知");
            }

            var subPriceStr = "";
            if (info.subPrice && info.subPrice.priceText) {
                subPriceStr = info.subPrice.priceText;
            }

            // 使用规格名称作为key，后面的数据会覆盖前面的（保留最后一个）
            tempMap[name] = {
                "规格名称": name,
                "日常价": rawPrice,
                "活动价": subPriceStr
            };
        }

        // 将去重后的对象转换为数组并处理分列
        var resultList = [];
        for (var key in tempMap) {
            var item = tempMap[key];
            var parts = item["规格名称"].split('|');

            // 分成两列：镜片套餐和折射率
            var package = parts[0] ? parts[0].trim() : "";
            var refraction = parts[1] ? parts[1].trim() : "";

            // 删除镜片套餐开头的"颜色分类:"字样
            package = package.replace(/^颜色分类[:：]\s*/g, '');

            resultList.push({
                "镜片套餐": package,
                "折射率": refraction,
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

        // 返回给影刀
        return resultList;

    } catch (e) {
        return "提取时发生异常报错: " + e.message;
    }
}
