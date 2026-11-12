// Sets the Windows exe icon and version info without wine, using resedit (pure JS)
const fs = require('fs'), path = require('path');
exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit');
  const R = ResEdit.default || ResEdit;
  const exe = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + '.exe');
  const data = fs.readFileSync(exe);
  const PE = R.NtExecutable.from(data, { ignoreCert: true });
  const res = R.NtExecutableResource.from(PE);
  const ico = R.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  R.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, ico.icons.map(i => i.data));
  const vi = R.Resource.VersionInfo.fromEntries(res.entries)[0];
  const v = ctx.packager.appInfo.version.split('.').map(Number);
  vi.setFileVersion(v[0], v[1], v[2], 0, 1033);
  vi.setProductVersion(v[0], v[1], v[2], 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: 'CANssm – CAN Signal Specification Modifier', ProductName: 'CANssm', CompanyName: 'Pack',
    OriginalFilename: 'CANssm.exe', InternalName: 'CANssm', LegalCopyright: '© 2026 Pack'
  });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(PE);
  fs.writeFileSync(exe, Buffer.from(PE.generate()));
  console.log('  • exe icon + version info set:', path.basename(exe));
};
