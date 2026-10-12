import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('preview',Path(__file__).with_name('preview-boleto-communications.py'))
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
class PreviewTest(unittest.TestCase):
 def setUp(self):
  self.row=dict(token='synthetic-token',payerDocument='12345678901',payerName='Cliente teste',payerEmail='a@example.com',number='1',dueDate='2026-10-20',amountCents=1000)
  self.contacts={'12345678901':[{'EMAIL':'a@example.com'}]}
 def check(self):return p.classify(self.row,self.contacts,'2026-10-12')
 def test_match_is_only_proposal(self):
  r=self.check();self.assertTrue(r['proposedAt']);self.assertFalse(r['sendEnabled']);self.assertTrue(r['requiresLiveValidation'])
 def test_partial_payment_stops(self):
  self.row['paidCents']=1;self.assertIsNone(self.check()['proposedAt'])
 def test_cancelled_stops(self):
  self.row['cancelledAt']='2026-10-11';self.assertIsNone(self.check()['proposedAt'])
 def test_mismatch_stops(self):
  self.row['payerEmail']='b@example.com';self.assertIn('emails_divergentes',self.check()['review']);self.assertIsNone(self.check()['proposedAt'])
 def test_duplicate_identity_stops(self):
  self.contacts['12345678901']*=2;self.assertIn('cadastro_duplicado',self.check()['review'])
 def test_no_name_fallback(self):
  self.row['payerDocument']='';self.assertIn('cadastro_ausente',self.check()['review'])
 def test_multiple_and_malformed(self):
  self.assertEqual(p.emails('A@example.com; a@example.com')[0],['a@example.com']);self.assertEqual(p.emails('a@example.com\r\nBcc: b@example.com')[1],'email_invalido')
 def test_trailing_separator(self):
  self.assertEqual(p.emails('a@example.com;'),(['a@example.com'],None))
  self.assertEqual(p.emails(' ; , '),([], 'sem_email'))
 def test_overdue_stops(self):
  self.row['dueDate']='2026-10-11';self.assertIsNone(self.check()['proposedAt'])
if __name__=='__main__':unittest.main()
