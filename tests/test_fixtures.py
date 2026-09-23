import pymupdf


def test_mixed_fixture_shape(mixed):
    with pymupdf.open(mixed) as d:
        assert d.page_count == 5
        assert len(d[0].get_images()) == 1
        assert d[2].get_images()[0][0] == d[3].get_images()[0][0]  # shared image


def test_encrypted_fixture_needs_password(encrypted):
    with pymupdf.open(encrypted) as d:
        assert d.needs_pass
