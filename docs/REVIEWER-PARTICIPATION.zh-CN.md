# 独立审核者如何实际参与

这份指南面向真实参与者。当前没有真人独立审核已完成的证据；自动化测试中的身份和判断都是明确标注的测试材料。

## 先邀请谁

固定 **3 位审核者，至少 2 位提交签名结果**。第三位用于备选与冲突处理，但不能用第三票抹掉已经提交的质疑。适合邀请熟悉被审项目的开发者、技术研究员或安全研究者。首次验收使用 OpenZeppelin 公开资料，不要求审核者购买代币或连接钱包。

还需要一个与买方、审核者和供应商分开的**身份核验方**，核实参与者实际控制人、利益关系和作品作者身份，并签署可追责的证明。它可以是愿意承担该工作的外部团队或个人，不是系统自动生成的机构。身份核验方和申诉仲裁者职责不同；仲裁公钥也须提前固定。

邀请时可以发送：

> 我们邀请你独立审核 FlashFirm 的公开资料技术报告。你需要核对每条结论及原文引用，并分别评分完整报告和每份移除一个 Agent 的材料，写出理由，最后使用你自己电脑上的专用审核密钥签署结果。允许提出质疑，不要求给出好评。你无需交出钱包私钥，也无需发送资金。请先说明与买方、供应商及其他审核者的控制关系或利益冲突，并约定工作量、期限、报酬和结果公开范围。

不要替别人生成密钥、代填评分或把自己控制的多个账号登记为不同的人。

## 审核者：在自己的电脑上操作

1. 安装 Node.js 22.13 或以上版本（建议 24），下载项目：

   ```sh
   git clone https://github.com/0xCaptain888/flashfirm.git
   cd flashfirm
   npm ci
   npm run review:console
   ```

2. 终端会显示 `http://127.0.0.1:某个端口`。在**这台电脑**的浏览器打开它。它只监听本机，不能把这个地址发给别人当远程审核页面。
3. 点击 **Create my local review key**，然后 **Download public key**。把下载的 `flashfirm-reviewer-public.pem` 发给协调人和身份核验方。
4. 私有文件默认在 `.runtime/my-independent-review/reviewer-key.json`，仅本人保管。它是独立的离线审核签名密钥，不是钱包密钥。不要发送整个 `.runtime`、私钥、助记词或项目访问令牌。
5. 等待公钥被固定到本次政策与买方计划。收到公共审核包 JSON 后，通过**另一个已确认身份的渠道**向买方核对 `planHash` 和 `buyerFingerprint` 两个 64 位指纹；不能只相信包内自报的指纹。
6. 在页面选择包，填入这两个指纹，点击 **Validate and open review**。篡改、过期或未登记审核者的包会被拒绝。
7. 阅读每条结论、精确引用及来源上下文。选择 `SUPPORTED`、`UNSUPPORTED`、`CONTRADICTED` 或 `INFERENCE`，填写至少 20 字符的解释。引用存在本身不等于结论正确。
8. 展开并阅读**每一份**完整/移除样本，按约定标准给每项 0–100 整数分，填写至少 20 字符的样本理由。样本没有显示移除对象的标签，但内容可能暴露作者，不能称为完全盲审。
9. 选择 `APPROVE` 或 `CHALLENGE`，写出最终理由。存在不支持的结论时，不允许签署 APPROVE。勾选本人独立完成确认，然后 **Sign and download my response**。
10. 把下载的 `flashfirm-human-review-response.json` 通过约定渠道发回。它包含签名判断，不含私钥。中途可以下载未签名草稿；下次用同一密钥、同一审核包和指纹打开页面后，选择 **Restore draft for this package** 恢复。重开页面不会自动恢复未下载的输入。

一条命令启动页面不代表已经完成审核；必须有真人阅读和本人签名。

## 协调人：准备真实任务和固定身份

1. 收齐 3 位审核者的公钥，确认外部身份核验方公钥和申诉仲裁公钥。
2. 核验方在计划签署**之前**，为买方、3 位审核者和每位供应商签署 `flashfirm-identity/1`。字段包括 `taskRoot`、`key`、不同实际控制人的 `subject`、角色、核验记录的 `evidenceHash`、签发/到期时间。供应商还须绑定准确的 `artifactHash` 和 `authorshipReviewed:true`。
3. 配置核验方的**公钥**：Workers 的 `IDENTITY_AUTHORITY_KEY` 或本机的 `FLASHFIRM_IDENTITY_AUTHORITY_KEY`。核验方私钥留在核验方电脑。证书示例和原始字段见 [TASK-SETTLEMENT.md](TASK-SETTLEMENT.md)；现有 PEM 离线密钥可使用 `scripts/task-envelope.mjs` 签署。
4. 导入真实报告，创建固定 3 位审核者的 review policy，买方签署与准确报告、评分标准、预算、收款地址绑定的 plan。当前承诺时点是**交付后、评分前**。已锁定的旧工作区不能偷偷更换参与者，应新建任务。
5. 每位供应商自己签署对准确作品的 `flashfirm-contribution-claim/1`，提供真实作者核验。历史报告由同一协调人控制多个 Agent，不能把这份旧报告改名包装成多个独立供应商的交付。可以先做真实外部事实审核；完整分配/付款验收需要满足真实参与者和作者身份规则的新任务。
6. 从工作区下载 **Reviewer package**（SDK：`reviewPackage(workspaceId)`）。计算并另行确认两个指纹：

   ```sh
   node --input-type=module -e 'import {readFile} from "node:fs/promises"; import {hash} from "./src/protocol.mjs"; const p=JSON.parse(await readFile(process.argv[1],"utf8")); console.log(JSON.stringify({planHash:hash(p.plan),buyerFingerprint:hash(p.plan.payload.buyerKey)}));' /private/review-package.json
   ```

   这里使用项目的 canonical JSON 哈希；不是直接对 PEM 文件运行 `sha256sum`。通过可信渠道交付指纹和包，不发送组织访问令牌。
7. 收到至少 2 份真实响应后，准备私有 JSON：`{responses:[响应1,响应2],certificates:[真实证书…],contributions:[真实作者签名…]}`。离线校验并组装：

   ```sh
   npm run review:assemble -- /private/review-package.json /private/actual-responses.json /private/new-review-import.json
   ```

8. 组装结果的 `actions` 包含每条 `decision` 和一个 `quality` 输入。通过已有的已认证工作区分别提交 `/decision` 和 `/flow/quality`。SDK 分别为 `submitDecision(workspaceId, input)` 和 `advanceTask(workspaceId, "quality", input)`。不要把整个私有导入文件上传到公共站点。
9. 重新检查 `/flow/readiness`。两人意见冲突、评分差异过大、身份/作者核验不足、申诉未结束或隐私证据不符，都会继续阻止付款。CHALLENGE 应按固定仲裁政策处理；不要删除不利意见或重新生成假签名。

实际 decision 路由为 `POST /api/workspaces/:id/decision`；不是 `/flow/decision`。其他操作路径见 [TASK-SETTLEMENT.md](TASK-SETTLEMENT.md)。

## 什么才算真人验收通过

保留审核者授权公开的身份/独立性核验记录、预先固定的公钥、准确审核包及指纹、本人签署的判断、冲突处理记录和服务器接收结果。公开时可以只展示脱敏证据承诺；私人联系方式和身份材料不要放进 GitHub。

`independenceCertified:false` 是本机工具的诚实默认值。密钥签名证明“该密钥签过这段判断”；它不能独自证明真实身份、没有利益冲突或审核质量。

机密任务禁止从公共资料审核包接口导出材料。需要单独获批的加密访问与审核环境，不能沿用本指南把私密资料作为公共 JSON 传递。
