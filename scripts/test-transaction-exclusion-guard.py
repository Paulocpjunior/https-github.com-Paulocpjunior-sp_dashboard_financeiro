import pathlib,subprocess,unittest
from transaction_exclusion_guard import validate_exclusion_rules
base=subprocess.check_output(['git','show','223d66099647db6d9d02aa3a168e174b053cc9e7:firestore.rules'],text=True)
current=pathlib.Path('firestore.rules').read_text()
class Guard(unittest.TestCase):
 def test_exact_approved_change(self):validate_exclusion_rules(base,current)
 def test_reject_original_admin_deletion(self):
  with self.assertRaises(AssertionError):validate_exclusion_rules(base,base)
 def test_reject_other_permissions(self):
  with self.assertRaises(AssertionError):validate_exclusion_rules(base,current.replace('allow create: if isAdmin();','allow create: if true;'))
 def test_reject_other_owner(self):
  with self.assertRaises(AssertionError):validate_exclusion_rules(base,current.replace('hpdsWehGGAYE3uKCar4pBiRVxFJ3','another-user'))
unittest.main()
