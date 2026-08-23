import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SaveToListButton } from '../SaveToListButton';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));
vi.mock('@/actions/lists', () => ({
  pinToDefaultListAction: vi.fn(),
  addItemToListAction: vi.fn(),
}));

describe('SaveToListButton', () => {
  it('redirects to /login with a next param when logged out', () => {
    render(<SaveToListButton sku="ABC123" isLoggedIn={false} />);
    fireEvent.click(screen.getByRole('button'));
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining('/login?next='));
  });
});
