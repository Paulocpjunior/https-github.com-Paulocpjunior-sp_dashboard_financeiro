import importlib.util,pathlib,tempfile,json,hashlib,unittest
spec=importlib.util.spec_from_file_location('replica',pathlib.Path(__file__).with_name('replicate-financial-backup.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Replica(unittest.TestCase):
 def test_readback_integrity_and_no_overwrite(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);src=root/'backup';src.mkdir();dest=root/'nas';dest.mkdir()
   (src/'firestore.json').write_text('{}')
   manifest={'project':'gen-lang-client-0888019226','completedAt':'2026-10-10','files':[{'file':'firestore.json','size':2,'sha256':m.sha(src/'firestore.json')}]}
   (src/'manifest.json').write_text(json.dumps(manifest));(src/'manifest.sha256').write_text(m.sha(src/'manifest.json'))
   out=m.replicate(src,dest);self.assertTrue((out/'REPLICA_VERIFIED.json').exists());self.assertEqual(m.verify(out),manifest)
   with self.assertRaisesRegex(ValueError,'já existe'):m.replicate(src,dest)
   (src/'firestore.json').write_text('invalid')
   with self.assertRaisesRegex(ValueError,'divergente'):m.replicate(src,dest)
if __name__=='__main__':unittest.main()
