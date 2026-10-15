import { Alert, Button, Card, Form, Input } from "antd";
import { useState } from "react";
import { BrandMark } from "./app-shell";

/**
 * The workspace access gate.
 *
 * The passphrase is submitted to `POST /api/session` in a request body and the
 * API answers with an HttpOnly cookie. It is therefore never held in component
 * state after submit, never written to storage, and never placed in a URL —
 * which also keeps it out of history, referrers and logs.
 */
export function AccessGate({
  pending,
  error,
  unreachable,
  onSubmit,
}: {
  pending: boolean;
  error: string | null;
  /** The session endpoint itself could not be read; the gate state is unknown. */
  unreachable: boolean;
  onSubmit: (passphrase: string) => void;
}) {
  const [passphrase, setPassphrase] = useState("");

  return (
    <main className="access-gate">
      <Card className="access-gate__card">
        <BrandMark collapsed={false} />
        <h1>访问口令</h1>
        <p className="access-gate__hint">
          该工作台已启用访问口令。输入管理员提供的口令后进入；口令仅通过本页提交，不会保存在浏览器中。
        </p>
        {unreachable && (
          <Alert
            type="warning"
            showIcon
            message="无法确认访问状态"
            description="暂时读不到登录状态，请确认服务可用后重试；在确认之前不会加载任何业务数据。"
            style={{ marginBottom: 16 }}
          />
        )}
        <Form
          layout="vertical"
          onFinish={() => onSubmit(passphrase)}
          disabled={pending || unreachable}
        >
          <Form.Item
            label="访问口令"
            name="passphrase"
            rules={[{ required: true, message: "请输入访问口令" }]}
          >
            <Input.Password
              autoFocus
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              placeholder="输入访问口令"
              autoComplete="current-password"
            />
          </Form.Item>
          {error !== null && (
            <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />
          )}
          <Button type="primary" htmlType="submit" block loading={pending}>
            进入工作台
          </Button>
        </Form>
      </Card>
    </main>
  );
}
