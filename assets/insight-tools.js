/* PEOPLEENT editorial tools; no network requests, storage or tracking of entered text. */
(function () {
  "use strict";
  function copyText(value, button, status) {
    function feedback(message) { if (status) status.textContent = message; }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(value).then(
        function () { feedback("내용이 복사됐습니다."); },
        function () { fallback(); }
      );
    } else fallback();
    function fallback() {
      var field = document.createElement("textarea");
      field.value = value;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      try { feedback(document.execCommand("copy") ? "내용이 복사됐습니다." : "복사가 차단됐습니다. 직접 선택해 복사하세요."); }
      catch (error) { feedback("복사가 차단됐습니다. 직접 선택해 복사하세요."); }
      field.remove();
    }
  }

  document.querySelectorAll("[data-pe-copy-template]").forEach(function (button) {
    button.addEventListener("click", function () {
      var field = document.getElementById(button.getAttribute("data-pe-copy-template"));
      if (!field) return;
      var status = button.parentElement.querySelector(".pe-tool-status");
      copyText(field.value, button, status);
    });
  });

  document.querySelectorAll("[data-pe-vendor-comparison]").forEach(function (tool) {
    var selects = Array.from(tool.querySelectorAll("select[data-vendor]"));
    var summary = tool.querySelector("[data-pe-comparison-summary]");
    function recount() {
      var vendors = ["A", "B", "C"];
      var lines = vendors.map(function (vendor) {
        var cells = selects.filter(function (x) { return x.dataset.vendor === vendor; });
        var unknown = cells.filter(function (x) { return x.value === "unknown"; }).length;
        var missing = cells.filter(function (x) { return x.value === "extra"; }).length;
        return vendor + "사: 확인 필요 " + unknown + "개 / 별도 비용 " + missing + "개";
      });
      selects.forEach(function (x) { x.dataset.state = x.value === "unknown" ? "unknown" : (x.value === "extra" ? "missing" : "included"); });
      if (summary) summary.textContent = lines.join(" · ") + ". '포함' 개수는 품질이나 가격 우열을 뜻하지 않습니다.";
    }
    tool.addEventListener("change", function (event) {
      if (event.target.matches("select[data-vendor]")) recount();
    });
    var button = tool.querySelector("[data-pe-copy-comparison]");
    if (button) button.addEventListener("click", function () {
      var lines = ["견적 범위 비교 / 실제 가격과 수량은 원견적서 확인", "항목\tA사\tB사\tC사"];
      tool.querySelectorAll("tr[data-row-label]").forEach(function (row) {
        var label = row.dataset.rowLabel;
        var values = ["A", "B", "C"].map(function (v) {
          var input = row.querySelector('select[data-vendor="' + v + '"]');
          return input ? input.options[input.selectedIndex].text : "-";
        });
        lines.push([label].concat(values).join("\t"));
      });
      lines.push("별도 비용 항목은 수량·단가·부가세·철수비 등을 포함해 재확인");
      copyText(lines.join("\n"), button, tool.querySelector("[data-pe-comparison-status]"));
    });
    recount();
  });
})();
