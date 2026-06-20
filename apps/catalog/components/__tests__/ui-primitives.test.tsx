import { render } from '@testing-library/react';

// jsdom does not implement ResizeObserver, which cmdk (Command) wires up on
// mount. Stub it so the closed-component smoke render does not throw. This is
// an environment polyfill, not a component change.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// cmdk auto-selects its first item on mount and calls scrollIntoView, which
// jsdom does not implement. Stub it so the render does not throw.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../ui/select';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover';
import { Command, CommandInput, CommandList, CommandItem } from '../ui/command';

describe('ui primitives import + render under jsdom', () => {
  it('Select renders a closed trigger without throwing', () => {
    const { getByText } = render(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">A</SelectItem>
        </SelectContent>
      </Select>
    );
    expect(getByText('Pick')).toBeInTheDocument();
  });
  it('Popover (closed) renders its trigger without throwing', () => {
    const { getByText } = render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Body</PopoverContent>
      </Popover>
    );
    expect(getByText('Open')).toBeInTheDocument();
  });
  it('Command renders an input + item without throwing', () => {
    const { getByPlaceholderText } = render(
      <Command>
        <CommandInput placeholder="Search" />
        <CommandList>
          <CommandItem>X</CommandItem>
        </CommandList>
      </Command>
    );
    expect(getByPlaceholderText('Search')).toBeInTheDocument();
  });
});
