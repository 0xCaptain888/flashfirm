# 真实审核、机密 TEE、同任务主网付款与退款验收

这次升级提供可运行的操作入口与更严格的证据核对。仍未取得真实外部审核、私密推理或同任务主网退款的成功记录。本文件区分代码就绪和真实验收。

## 当前能直接做的免费检查

```sh
npm test
npm run inference:inspect
```

第二条通过官方 `@phala/aci-verifier` 0.11.0 查询固定 Phala ACI 服务。它不发送私密材料、不发推理请求、不消耗项目付费模型调用额度。已有的真实观察记录在 [aci-connection-discovery.json](../evidence/aci-connection-discovery.json)：

- 硬件证明、新 nonce/keyset 绑定、有效期、测量 Compose 和实际 TLS 通道共 5 项通过；
- 私钥保管项跳过，未满足独立 OS/KMS/模型评审；
- 未提供 ACI 凭证，未执行模型推理。

这是有时间戳的连接观察，不是可独立重放的完整硬件证明，也不是“可信推理已完成”。观察到的镜像哈希不能自动加入受信任发布白名单。

## 1. 真人独立审核

按 [逐步参与指南](REVIEWER-PARTICIPATION.zh-CN.md) 招募 3 位预先固定的审核者、至少取得 2 份真实签名，并由独立核验方签署完整身份/作者证明。先完成这项，再做这份任务的资金验收。不能用自动化评分冒充真人参与。

## 2. 先验收机密引用任务，再验收可信模型推理

### A. 机密引用任务

这条路径只在 TEE 内核对引用，**不调用大模型**：

1. 审核私密工作负载的源码、固定镜像/Compose、平台测量值、调试设置、日志、密钥管理和材料保留策略。审核方需要真实承担判断，不能让项目程序替其签署“已审计”。
2. 取得审核方签署的 `flashfirm-secret-release/1`。它必须绑定本次 plan 的 `taskRoot`、`resultRoot`、`privateTaskDigest`，明确 `privateQuotationAllowed:true`、`modelInferenceAllowed:false`，包含真实审计记录哈希、app ID、准确 Compose、MRTD/RTMR0–2 测量值和短有效期。
3. 准备已获材料所有者许可的测试资料。先用无敏感真实身份数据的小样本，不能把钱包私钥/API Key 当测试材料。买方在计划中固定私密任务的 canonical JSON 摘要。
4. 在私有目录准备 `{endpoint,flow,task,approval}` JSON 并设置 `chmod 600`。`endpoint` 是该实例根路径的 HTTPS `.phala.network` 地址。配置 `FLASHFIRM_SECRET_RELEASE_AUTHORITY_KEY` 为审核方公钥。
5. 先做完全离线预览：

   ```sh
   npm run tee:private -- preview /private/quotation-input.json /private/shared-runtime
   ```

6. 预览通过后，针对指定实例的新启动费用、运行时长和关机条件另行确认；当前实例仍保持关机，旧的 $5 首轮预算不能作为无期限续费许可。
7. 获批后启动既定实例、核对公网 endpoint，再执行：

   ```sh
   npm run tee:private -- execute /private/quotation-input.json /private/shared-runtime /private/new-private-output
   ```

程序先发送随机 nonce 和任务摘要，再从官方服务取得硬件验签和原始 quote，核对应用、平台、审批。通过后才发送加密材料，核对加密签名结果，并再次取得官方硬件结果用于任务证明。`shared-runtime/private-release-fences` 对同一审批只能放行一次；网络不确定时保留现场手工对账，不删除目录重试。

实际 PASS 会输出任务绑定的 `{proof,approval}`，通过已认证 `flow/privacy` 提交。CHALLENGED 不会提升为通过。私有输出留在访问受控目录；不要上传公共 GitHub。结束后核对关机。

### B. 可信模型推理

专用 quotation 实例不会因为启用 TEE 就自动把第三方 DeepSeek API 变成可信推理。当前模型网关 Key 不能替代 Phala ACI Key。

需要：

- 实际可用的 Phala ACI API 凭证，保存在本机私有配置或受控服务中；
- 模型、输出上限、供应商实际定价及保守调用预留；
- 外部签署的 `flashfirm-aci-release/1` 和新鲜 `flashfirm-aci-runtime-audit/1`，绑定准确的 OS/KMS、模型/运行时、gateway/keyset 和 upstream session；
- 独立配置的推理验证服务签名身份，其公钥必须与释放审批方及任务参与者不同；
- 买方允许的具体私密输入及调用范围。

先运行免费 discovery，再让真实审核方评审对应发布及新鲜会话。不要把“未知”自动改成 true。私密团队预览：

```sh
npm run inference:team -- preview /private/approved-team.json /private/shared-runtime
```

累计限制仍是 **¥20、12 次**；现有 **10 次、¥15.91 保守预留**，剩余 2 次和 ¥4.09。单次小样本可以先精确预检；3 位 worker 的完整重跑不适配剩余额度，不能静默扩容。通过新的明确额度审批和团队预检后，才运行 `inference:team ... execute`。执行后必须得到完整请求/响应回执、独立核验签名及逐作品任务绑定，才能提交 `flow/inference`。完整配置见 [SETTLEMENT-V2-ACI.md](SETTLEMENT-V2-ACI.md)。

## 3. 同任务主网付款

先固定真实报告 → 外部审核与作者证明 → 贡献分配 → appeal 等待期 → manifest。资金证据必须来自这个 manifest，历史 0.5 NEAR 转账不能复用。

可以选择两条互斥路径：

- 原生 NEAR 共同托管预算：一次资金存入，固定 worker/费用/剩余预算的单独付款。默认关闭的主网适配器和 keyless 合约要求见 [ESCROW-REVIEW-UPGRADE.md](ESCROW-REVIEW-UPGRADE.md)。不等于跨链。
- NEAR → Arbitrum USDC：v2 manifest 的每项 worker、协议费、剩余预算义务分别创建买方签名 invoice，绑定独立签名报价与目标地址。每张单独入金，不能称为共同资金池自动分账。

跨链路径新增只读入口：

```text
GET /api/workspaces/:id/flow/payment-handoff
FlashFirmClient.paymentHandoff(workspaceId)
```

工作区 **Prepare task payment handoff** 提供准确的来源、收款人、整数金额、最低到账额、最高费用、报价截止时间和按来源账户合计。缺少义务明确列出。已提交、已到账或等待退款的订单只允许核对，不会再次生成付款预览。该下载不调用钱包。

下一步流程：

1. 读取本次 readiness，确认真实身份、审核、作者、隐私和申诉均已放行。
2. 使用真实报价准备每项 invoice。先显示所有来源本金、Gas 上限、路由成本和总上限，确认值得做；小额费用义务可能低于桥最低限额。
3. 用户确认**这次具体预算**后，在自己钱包签署准确交易。保留每项 source hash；不需要把私钥交给开发者。不要使用已过期的报价。
4. 对每张 invoice 提交 `flow/verify` 的 `{invoiceHash,hash}`。核对最终 NEAR 原生 Transfer、Gas、官方签名报价及 relay 关联、Arbitrum 最终 ERC-20 Transfer。
5. 只有所有正额义务都已核验，才可表示这份任务完全结算。一项失败不代表其他项可以重复付款。

## 4. 真实跨链退款

**预算结余支付给买方**和**跨链订单失败退回源链本金**是两件不同的事。后者必须有自己链上的退款证据。

已有加强后的验证器，但没有真实失败订单退款被验收。不要向随机失效地址打款来“测试退款”，也不要把收款人余额变动当退款证明。

可先向桥服务方确认支持的最小额、可退款场景、是否允许过期后入金、退款手续费/时间和原生 NEAR 返回方式。若服务方没有明确可控、获支持的退款测试方法，就保留未验收状态；不保证故意制造故障一定会退款。

得到具体可控测试方法后：

1. 新建仍绑定这份真实任务的 invoice/quote，另行明确风险本金、Gas/桥费、可能损失和最长等待时间，再取得该次资金确认。
2. 用户在钱包完成精确原生转账，保存 source hash。
3. `flow/verify` 核验本次来源交易和官方映射。只有官方返回 REFUNDED 且来源交易确实核验，才进入 `REFUND_PENDING`；这时仍不算退款成功。
4. 取得官方关联的退款交易 hash，提交 `flow/refund`：`{invoiceHash,hash:退款交易hash}`。
5. 验证器重新查询原始入金、完整唯一的 receipt tree、实际成功的原生 Transfer、准确接收人/金额/时间，拒绝无关捐款、历史交易和不可达收据。wrap.near 返回需具备该 deposit 发起且金额完全匹配的祖先 `near_withdraw`。
6. 只有这些检查通过才能设为 `REFUNDED`。结果记录准确退款及 `unreturnedPrincipalYocto`；差额不会自动解释成“手续费”。RPC 没有完整历史收据时继续保持未核验。

## 为完成真实验收，还需用户协调什么

1. 确认愿意参与的 3 位真实审核者和外部核验/审核方。先让他们按本机指南生成并分享**公钥**。
2. 提供真实 ACI 访问资格、可评审的生产发布/推理证明和获准的小样本材料。调用预算与实例费用分别做精确预览，不沿用旧付款授权。
3. 确认真实供应商、收款地址和任务付款预算；在钱包完成最终签名。退款需要桥方支持的可控场景，不能承诺无风险制造失败。

项目不会因为缺少以上外部事实而伪造参与者、硬件审核或主网收据。
