"""Allow only the approved owner-only exclusion change against the deployed base."""
def validate_exclusion_rules(base, new):
    logical = 'function isAdministrativeExclusion() {\n      return isAdmin()'
    physical = 'allow delete: if isAdmin();\n    }\n\n    match /clientRegistry'
    assert base.count(logical) == 1 and base.count(physical) == 1, 'Base de regras inesperada.'
    expected = base.replace(logical, logical.replace('isAdmin()', 'isMaster()')).replace(physical, physical.replace('isAdmin()', 'isMaster()'))
    assert new == expected, 'Alteração fora do escopo: somente exclusão de lançamentos pelo titular é permitida.'
