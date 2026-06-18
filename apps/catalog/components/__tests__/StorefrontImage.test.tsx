import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StorefrontImage } from '@/components/StorefrontImage';

// next/image needs minimal mocking under jsdom — render a plain <img>.
vi.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string };
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img src={src} alt={alt} data-testid="next-image" />;
  },
}));

describe('StorefrontImage', () => {
  it('renders the Wine-icon placeholder when src is null', () => {
    render(<StorefrontImage src={null} alt="A wine bottle" />);
    expect(screen.getByTestId('storefront-image-placeholder')).toBeInTheDocument();
    expect(screen.queryByTestId('next-image')).not.toBeInTheDocument();
  });

  it('renders the placeholder when src is an empty string', () => {
    render(<StorefrontImage src="" alt="A wine bottle" />);
    expect(screen.getByTestId('storefront-image-placeholder')).toBeInTheDocument();
  });

  it('renders the image (not the placeholder) when src is present', () => {
    render(
      <StorefrontImage
        src="https://th.wine-now.com/media/x.jpg"
        alt="Chateau X"
      />,
    );
    const img = screen.getByTestId('next-image');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://th.wine-now.com/media/x.jpg');
    expect(screen.queryByTestId('storefront-image-placeholder')).not.toBeInTheDocument();
  });
});
