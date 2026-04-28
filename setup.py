import re
from setuptools import setup, find_packages

with open("requirements.txt") as f:
    install_requires = f.read().strip().split("\n")

with open("next_ai/__init__.py") as f:
    version = re.search(r'__version__ = ["\']([^"\']+)["\']', f.read()).group(1)

setup(
	name="next_ai",
	version=version,
	description="Next AI - Natural Language Interface for ERPNext",
	author="Dércio Bobo",
	author_email="derciobob@gmail.com",
	packages=find_packages(),
	zip_safe=False,
	include_package_data=True,
	install_requires=install_requires
)
