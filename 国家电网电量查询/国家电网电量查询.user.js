// ==UserScript==
// @name         国家电网电量查询
// @name:en      State Grid Electricity Usage Query
// @version      1.0.0
// @description  在国家电网电量电费查询页恢复非智能交费签约户号的“近30天”切换按钮，使用页面原有逻辑查询电量。
// @description:en Restore the last 30 days option on the State Grid electricity query page for accounts without smart payment enrollment, using the page's existing query logic.
// @license      LGPL-3.0
// @author       Augenstern-O
// @namespace    https://github.com/Augenstern-O
// @homepage     https://github.com/Augenstern-O/UserScripts/tree/main/国家电网电量查询
// @supportURL   https://github.com/Augenstern-O/UserScripts/issues
// @match        https://www.95598.cn/osgweb/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

// 初始化查询页的“近30天”按钮显示修正。
(function () {
  'use strict';

  // 背景：电量查询页对“非智能交费签约”户号会隐藏“近30天”选项
  //      （即把组件属性 show30DayRadio 置为 false，并展示“请前往网上国网APP开通智能交费签约”提示）。
  //      这只是前端展示控制——本脚本仅把它恢复为 true 让按钮显示，不发送任何请求；
  //      点击“近30天”后的数据查询由页面自身逻辑完成，结果以网站实际返回为准。
  // 注意：切换户号时，页面会重新请求签约状态并在异步回调里再次隐藏按钮，因此用轻量轮询持续修正。

  // 定期检查查询组件，恢复被页面异步逻辑隐藏的按钮。
  setInterval(function () {
    // 仅在“电量电费查询”页生效
    if (location.pathname.indexOf('electricityCharge') === -1) return;

    // #main 是查询页主组件容器；再用特征属性 show30DayRadio 确认是目标组件，避免误伤其它页面
    var main = document.querySelector('#main');
    var vm = main && main.__vue__;
    if (vm && 'show30DayRadio' in vm && vm.show30DayRadio === false) {
      vm.show30DayRadio = true;   // 响应式属性，置 true 后“近30天”按钮立即重新渲染
    }
  }, 500);
})();
