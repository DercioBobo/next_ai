from setuptools import setup, find_packages

with open("requirements.txt") as f:
    install_requires = f.read().strip().split("\n")

from next_ai import __version__ as version

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
