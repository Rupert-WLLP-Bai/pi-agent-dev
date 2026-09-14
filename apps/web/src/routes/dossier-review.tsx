import { InboxOutlined } from "@ant-design/icons";
import { useMutation } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Descriptions,
  Empty,
  Input,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import { useState } from "react";
import { type DossierAmountChain, reviewDossierAmountChain } from "../api";

/**
 * 卷宗核对: the cross-document amount check over one project dossier.
 *
 * Everything on this page is discarded when it is left, because the review is
 * stateless: it answers whether a set of files agrees with each other, which is
 * a question about those bytes and not about a case with a lifecycle.
 */

const ACCEPTED_EXTENSIONS = [".xlsx", ".docx", ".pdf", ".txt", ".md"];
const MAX_UPLOAD_BYTES = 10_485_760;

type SheetTotal = DossierAmountChain["sheetTotals"][number];

const sideLabels = { customer: "客户侧", supplier: "供应商侧" } as const;
const stanceLabels = { revenue: "收入合同", procurement: "支出合同" } as const;

const yuan = (amount: number): string =>
  amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const taxLabel = (taxIncluded: boolean | null): string =>
  taxIncluded === null ? "未标注" : taxIncluded ? "含税" : "不含税";

/** A sheet total as a citation: the cell it lives in and what labels it. */
function TotalCitation({ total }: { total: SheetTotal }) {
  return (
    <Space size={4} wrap>
      <Typography.Text className="mono">
        {total.sheet}!{total.ref}
      </Typography.Text>
      <Typography.Text>{yuan(total.amount)}</Typography.Text>
      {total.side !== null && <Tag>{sideLabels[total.side]}</Tag>}
      <Tag>{taxLabel(total.taxIncluded)}</Tag>
      {!total.derived && <Tag color="orange">手填</Tag>}
    </Space>
  );
}

export default function DossierReviewPage() {
  const { message } = AntApp.useApp();
  const [pending, setPending] = useState<Array<{ uid: string; file: File }>>([]);
  const [ownNames, setOwnNames] = useState("");
  const [review, setReview] = useState<DossierAmountChain | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      reviewDossierAmountChain({
        files: pending.map((entry) => entry.file),
        ownOrganizationNames: ownNames,
      }),
    onSuccess: setReview,
    onError: (error: Error) => message.error(error.message),
  });

  const sheetColumns = [
    {
      title: "单元格",
      dataIndex: "ref",
      render: (_: unknown, total: SheetTotal) => (
        <Typography.Text className="mono">
          {total.sheet}!{total.ref}
        </Typography.Text>
      ),
    },
    { title: "标签", dataIndex: "label" },
    {
      title: "侧别",
      dataIndex: "side",
      render: (side: SheetTotal["side"]) => (side === null ? "—" : sideLabels[side]),
    },
    {
      title: "税基",
      dataIndex: "taxIncluded",
      render: (taxIncluded: boolean | null) => taxLabel(taxIncluded),
    },
    {
      title: "金额",
      dataIndex: "amount",
      align: "right" as const,
      render: (amount: number) => yuan(amount),
    },
    {
      title: "来源",
      dataIndex: "derived",
      render: (derived: boolean) =>
        derived ? <Tag color="green">公式</Tag> : <Tag color="orange">手填</Tag>,
    },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            卷宗核对
          </Typography.Title>
          <Typography.Text type="secondary">
            把一个项目卷宗的测算表与收入/支出合同一起提交，核对同一笔钱在几份材料里是否一致。不落库，离开页面即丢弃。
          </Typography.Text>
        </div>
      </div>

      <Card title="卷宗材料">
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Upload.Dragger
            multiple
            accept={ACCEPTED_EXTENSIONS.join(",")}
            fileList={pending.map((entry) => ({
              uid: entry.uid,
              name: entry.file.name,
              status: "done" as const,
            }))}
            beforeUpload={(file) => {
              // Refused here so an oversized file never reaches the API, which
              // would answer 413 anyway.
              if (file.size > MAX_UPLOAD_BYTES) {
                message.error(`${file.name} 超过 10MB 限制`);
                return Upload.LIST_IGNORE;
              }
              setPending((current) => [...current, { uid: crypto.randomUUID(), file }]);
              return false;
            }}
            onRemove={(target) => {
              setPending((current) => current.filter((entry) => entry.uid !== target.uid));
            }}
            disabled={mutation.isPending}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">拖入同一项目的多个文件</p>
            <p className="ant-upload-hint">
              测算表（.xlsx）提供两侧合计，合同（.docx / .pdf）提供载明总额；至少两个文件。
            </p>
          </Upload.Dragger>

          <Space wrap>
            <Input
              style={{ width: 420 }}
              placeholder="本方主体名称，逗号分隔；留空用服务端配置"
              value={ownNames}
              onChange={(event) => setOwnNames(event.target.value)}
              disabled={mutation.isPending}
            />
            <Button
              type="primary"
              loading={mutation.isPending}
              disabled={pending.length < 2}
              onClick={() => mutation.mutate()}
            >
              开始核对
            </Button>
          </Space>
        </Space>
      </Card>

      {review === null ? (
        <Card>
          <Empty description="提交卷宗后在此显示金额链核对结果" />
        </Card>
      ) : (
        <>
          <Card title="核对结论">
            <Descriptions size="small" column={{ xs: 1, sm: 4 }} colon={false}>
              <Descriptions.Item label="比对金额项">{review.checked}</Descriptions.Item>
              <Descriptions.Item label="一致">{review.matched.length}</Descriptions.Item>
              <Descriptions.Item label="不一致">{review.mismatched.length}</Descriptions.Item>
              <Descriptions.Item label="无可比对象">{review.unchecked.length}</Descriptions.Item>
            </Descriptions>
          </Card>

          {review.mismatched.length > 0 && (
            <Card title="金额不一致">
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                {review.mismatched.map((result) => (
                  <Alert
                    key={`${result.contract.artifactName}-${result.contract.amount}`}
                    type="error"
                    showIcon
                    message={`${result.contract.artifactName} 载明 ${yuan(result.contract.amount)}，与测算表相差 ${yuan(result.difference)}`}
                    description={
                      <Space direction="vertical" size={2}>
                        <Typography.Text type="secondary">
                          {stanceLabels[result.contract.stance]}，按{" "}
                          {
                            sideLabels[
                              result.contract.stance === "revenue" ? "customer" : "supplier"
                            ]
                          }
                          比对；最接近的合计：
                        </Typography.Text>
                        <TotalCitation total={result.nearest} />
                      </Space>
                    }
                  />
                ))}
              </Space>
            </Card>
          )}

          {review.matched.length > 0 && (
            <Card title="金额一致">
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                {review.matched.map((result) => (
                  <Space key={`${result.contract.artifactName}-${result.contract.amount}`} wrap>
                    <Tag color="green">一致</Tag>
                    <Typography.Text>{result.contract.artifactName}</Typography.Text>
                    <Typography.Text strong>{yuan(result.contract.amount)}</Typography.Text>
                    <Typography.Text type="secondary">=</Typography.Text>
                    <TotalCitation total={result.matched} />
                  </Space>
                ))}
              </Space>
            </Card>
          )}

          {review.unchecked.length > 0 && (
            <Card title="未能比对">
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                {review.unchecked.map((result) => (
                  <Alert
                    key={`${result.contract.artifactName}-${result.contract.amount}`}
                    type="warning"
                    showIcon
                    message={`${result.contract.artifactName} 载明 ${yuan(result.contract.amount)}`}
                    description={result.reason}
                  />
                ))}
              </Space>
            </Card>
          )}

          {review.handEnteredTotals.length > 0 && (
            <Card title="没有公式支撑的合计">
              <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
                这些合计是手填的：数字本身可能没错，但表格自身的算术不为它背书，明细一改它不会跟着改。
              </Typography.Paragraph>
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                {review.handEnteredTotals.map((total) => (
                  <TotalCitation key={`${total.sheet}-${total.ref}`} total={total} />
                ))}
              </Space>
            </Card>
          )}

          <Card title="材料清单">
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              {review.artifacts.map((artifact) => (
                <div key={artifact.name}>
                  <Space wrap>
                    <Typography.Text strong>{artifact.name}</Typography.Text>
                    <Tag>{artifact.kind === "SPREADSHEET" ? "测算表" : "合同"}</Tag>
                    {artifact.stance !== null && (
                      <Tag color="blue">{stanceLabels[artifact.stance]}</Tag>
                    )}
                    {artifact.kind === "SPREADSHEET" && (
                      <Typography.Text type="secondary">
                        {artifact.sheetTotalCount} 处合计
                      </Typography.Text>
                    )}
                  </Space>
                  {artifact.error !== null && (
                    <Typography.Paragraph type="danger" style={{ marginBottom: 0 }}>
                      解析失败：{artifact.error}
                    </Typography.Paragraph>
                  )}
                  {artifact.kind === "CONTRACT" && (
                    <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                      {artifact.stanceBasis}
                    </Typography.Paragraph>
                  )}
                  {artifact.statedTotals.map((total) => (
                    <Typography.Paragraph
                      key={total.amount}
                      type="secondary"
                      style={{ marginBottom: 0, fontSize: 12 }}
                    >
                      载明 {yuan(total.amount)}——{total.basis}
                    </Typography.Paragraph>
                  ))}
                </div>
              ))}
            </Space>
          </Card>

          <Card title="测算表合计">
            <Table
              size="small"
              rowKey={(total) => `${total.sheet}-${total.ref}`}
              dataSource={review.sheetTotals}
              columns={sheetColumns}
              pagination={false}
            />
          </Card>
        </>
      )}
    </div>
  );
}
