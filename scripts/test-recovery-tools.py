import importlib.util,pathlib,sys,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('deploy_attachments',pathlib.Path(__file__).with_name('deploy-financial-attachments.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class DeploymentSafety(unittest.TestCase):
 def test_plan_never_calls_cloud(self):
  with patch.object(sys,'argv',['deploy']),patch.object(module,'gc') as cloud,patch('builtins.print'):
   module.main();cloud.assert_not_called()
 def test_apply_requires_guard_before_cloud(self):
  with patch.object(sys,'argv',['deploy','--apply']),patch.object(module.subprocess,'run',side_effect=RuntimeError('commit not authorized')),patch.object(module,'gc') as cloud:
   with self.assertRaisesRegex(RuntimeError,'not authorized'):module.main()
   cloud.assert_not_called()
if __name__=='__main__':unittest.main()
