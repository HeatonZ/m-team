import type { FC } from 'react';

interface HeaderProps {
  onRefresh: () => void;
}

export const Header: FC<HeaderProps> = ({ onRefresh }) => {
  return (
    <div className="header-row">
      <h1>📊 m-team 任务看板</h1>
      <button className="refresh-btn" onClick={onRefresh}>
        🔄 刷新
      </button>
    </div>
  );
};
