import type { FC } from 'react';

interface HeaderProps {
  onRefresh: () => void;
}

export const Header: FC<HeaderProps> = ({ onRefresh }) => {
  return (
    <div className="header-row">
      <h1>m-team task dashboard</h1>
      <button className="refresh-btn" onClick={onRefresh}>
        Refresh
      </button>
    </div>
  );
};
