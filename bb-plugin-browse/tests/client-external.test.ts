import { expect, it, vi } from 'vitest';
import { openClientExternal } from '../src/client-external';
it('opens on the viewing desktop, or in a web-client tab, never through server RPC', () => {
 const desktop = {openExternalUrl: vi.fn()};
 const client = {location: {origin:'https://bb.test'}, parent:null, open:vi.fn(), bbDesktop:desktop} as any;client.parent=client;
 openClientExternal('https://jackfir.com/',client);
 expect(desktop.openExternalUrl).toHaveBeenCalledWith('https://jackfir.com/');expect(client.open).not.toHaveBeenCalled();
 delete client.bbDesktop;openClientExternal('https://jackfir.com/',client);
 expect(client.open).toHaveBeenCalledWith('https://jackfir.com/','_blank','noopener,noreferrer');
 for(const url of ['file:///tmp/x','javascript:alert(1)','https://user:pass@example.com'])expect(()=>openClientExternal(url,client)).toThrow();
});
it('uses the same-origin parent desktop bridge from the viewer iframe', () => {
 const openExternalUrl = vi.fn();
 const parent = {location:{origin:'https://bb.test'},bbDesktop:{openExternalUrl}};
 const client = {location:parent.location,parent,open:vi.fn()} as any;
 openClientExternal('https://jackfir.com/',client);expect(openExternalUrl).toHaveBeenCalledOnce();expect(client.open).not.toHaveBeenCalled();
});
