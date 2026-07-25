from scripts.wine_knowledge import vocab


def test_vocabulary_matches_spec_exactly():
    # The six §4.5 verbs, no more, no less.
    assert set(vocab.RELATIONSHIP_VERBS) == {
        "grown_in", "produces_style", "exhibits_style",
        "sub_appellation_of", "classified_under", "outranks",
    }


def test_every_verb_has_a_canonical_direction():
    # DIRECTION maps verb -> (from_types, to_types); every verb present.
    for verb in vocab.RELATIONSHIP_VERBS:
        assert verb in vocab.DIRECTION
        frm, to = vocab.DIRECTION[verb]
        assert frm and to
