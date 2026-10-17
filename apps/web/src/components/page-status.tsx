import { ReloadOutlined } from "@ant-design/icons";
import { Button, Card, Empty, Result, Skeleton, Space, Typography } from "antd";
import type { ReactNode } from "react";

/**
 * Shared loading / error / empty shells for M2 page consistency.
 * Business pages keep their own headers; this only fills the body state.
 */
export function PageLoading({ rows = 6 }: { rows?: number }) {
  return <Skeleton active paragraph={{ rows }} />;
}

export function PageError({
  title,
  description,
  onRetry,
  extra,
}: {
  title: string;
  description?: string;
  onRetry?: () => void;
  extra?: ReactNode;
}) {
  return (
    <Result
      status="error"
      title={title}
      subTitle={description}
      extra={
        extra ??
        (onRetry ? (
          <Button type="primary" onClick={onRetry}>
            重试
          </Button>
        ) : undefined)
      }
    />
  );
}

export function PageEmpty({
  description,
  children,
}: {
  description: ReactNode;
  children?: ReactNode;
}) {
  return <Empty description={description}>{children}</Empty>;
}

export function PageHead({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <Typography.Title level={3} style={{ margin: 0, fontSize: 20 }}>
          {title}
        </Typography.Title>
        {description !== undefined && description !== null && description !== "" ? (
          <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
            {description}
          </Typography.Text>
        ) : null}
      </div>
      {actions !== undefined && actions !== null ? (
        <div className="page-head-actions">{actions}</div>
      ) : null}
    </div>
  );
}

export function PageRefreshAction({
  loading = false,
  onRefresh,
  label = "刷新",
}: {
  loading?: boolean;
  onRefresh: () => void;
  label?: string;
}) {
  return (
    <Button icon={<ReloadOutlined />} loading={loading} onClick={onRefresh}>
      {label}
    </Button>
  );
}

export function PageHeadActions({
  refreshing,
  onRefresh,
  children,
}: {
  refreshing?: boolean;
  onRefresh: () => void;
  children?: ReactNode;
}) {
  return (
    <Space wrap>
      <PageRefreshAction loading={refreshing} onRefresh={onRefresh} />
      {children}
    </Space>
  );
}

export function PageQueryBody({
  initialLoading,
  initialError,
  errorMessage,
  onRetry,
  empty = false,
  emptyDescription = "暂无数据",
  emptyAction,
  skeletonRows = 5,
  children,
}: {
  initialLoading: boolean;
  initialError: boolean;
  errorMessage?: string;
  onRetry: () => void;
  empty?: boolean;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;
  skeletonRows?: number;
  children: ReactNode;
}) {
  if (initialLoading) {
    return (
      <Card>
        <PageLoading rows={skeletonRows} />
      </Card>
    );
  }
  if (initialError) {
    return (
      <Card>
        <PageError title="加载失败" description={errorMessage} onRetry={onRetry} />
      </Card>
    );
  }
  if (empty) {
    return (
      <Card>
        <PageEmpty description={emptyDescription}>{emptyAction}</PageEmpty>
      </Card>
    );
  }
  return children;
}
