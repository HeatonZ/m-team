# Examples

## Good example: coding baton

Current description:
- add a missing regression test for parser edge case X

Good final message:

```text
Result summary: 已补充解析器边界条件 X 的回归测试。
Files: tests/parser-edge-x.test.ts
Evidence: 新测试覆盖输入 X，当前断言结果符合预期。
Unresolved issues: none
```

## Good example: research baton

Current description:
- find three qualified supplier candidates and write a comparison note

Good final message:

```text
Result summary: 已完成三家候选供应商的筛选与对比。
Files: outputs/suppliers.json, outputs/supplier-comparison.md
Evidence: suppliers.json 包含三家候选的价格、MOQ 与链接；supplier-comparison.md 记录了筛选依据。
Unresolved issues: none
```

## Good example: blocked baton

Current description:
- verify endpoint behavior with production credentials

Good final message:

```text
Result summary: 已尝试验证接口行为，但当前 baton 被阻塞。
Files: outputs/endpoint-debug.md
Evidence: endpoint-debug.md 记录了请求方式、返回内容与失败位置。
Unresolved issues: 缺少完成当前验证所需的生产凭证。
```

## Bad example

```text
I looked into it and made progress. Next step should continue from here.
```

Why bad:
- no clear baton result
- no files
- no evidence
- no factual unresolved issue
- executor is implicitly inventing the next baton
