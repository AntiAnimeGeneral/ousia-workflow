# Pending

## 条目

- 明确generic `validate` task与`doc-validation`入口的边界，并决定validation checks是agent selector、CLI selector还是只读metadata。
- 为required project fact建立实际读取与缺失diagnostic；optional fact缺失应作为evidence gap，而不是静默规则。
- 重新定义prompt budget是否统计project facts与native host injection，避免把“route + 全部concerns”上界误当真实读取负担。
- 对齐README、`docs/**`的文档validation触发范围与checker实际扫描范围。
