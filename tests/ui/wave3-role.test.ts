/** Wave 3 (#2): the web address decides the role. */
import { describe, expect, it } from 'vitest';
import { roleIdFromHost, windowUrlFor } from '@/lib/session/role-host';

const roles = [{ id: 'senior' }, { id: 'junior-a' }, { id: 'junior-b' }];
const url = (hostname: string, port = '3001', pathname = '/workspace/p/w', search = '?v=1') => ({ protocol: 'http:', hostname, port, pathname, search });

describe('the role a host name fixes', () => {
  it('a role in front of the host fixes the window', () => {
    expect(roleIdFromHost('junior-b.localhost:3001', roles)).toBe('junior-b');
    expect(roleIdFromHost('senior.localhost', roles)).toBe('senior');
    expect(roleIdFromHost('Junior-A.example.com:8080', roles)).toBe('junior-a');
  });
  it('bare localhost, an IP address, an unknown prefix or no host: the cookie decides', () => {
    for (const h of ['localhost:3001', '127.0.0.1:3001', '[::1]:3001', 'someone.localhost:3001', 'junior-b', null, undefined, '']) expect(roleIdFromHost(h, roles)).toBeNull();
  });
});

describe('the same page in another role\'s window', () => {
  it('swaps the prefix, keeps port, path and query', () => {
    expect(windowUrlFor(url('senior.localhost'), 'junior-a', roles)).toBe('http://junior-a.localhost:3001/workspace/p/w?v=1');
  });
  it('bare localhost gets a prefix; an IP address has no other window', () => {
    expect(windowUrlFor(url('localhost', ''), 'junior-b', roles)).toBe('http://junior-b.localhost/workspace/p/w?v=1');
    expect(windowUrlFor(url('127.0.0.1'), 'junior-b', roles)).toBeNull();
  });
});
