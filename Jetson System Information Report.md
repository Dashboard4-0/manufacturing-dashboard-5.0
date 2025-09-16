# Jetson System Information Report Generated: Tue 16 Sep 13:57:44 BST 2025

System: Linux Omnitech-ES 5.10.192-tegra #1 SMP PREEMPT Thu Jun 13 20:07:24 PDT 2024 aarch64 aarch64
aarch64 GNU/Linux Memory: total used free shared buff/cache available Mem: 15Gi 1.9Gi 11Gi 181Mi
1.6Gi 12Gi Swap: 7.6Gi 0B 7.6Gi CPU: Architecture: aarch64 CPU op-mode(s): 32-bit, 64-bit Byte
Order: Little Endian CPU(s): 8 On-line CPU(s) list: 0-3 Off-line CPU(s) list: 4-7 Thread(s) per
core: 1 Core(s) per socket: 4 Socket(s): 1 Vendor ID: ARM Model: 1 Model name: ARMv8 Processor rev 1
(v8l) Stepping: r0p1 CPU max MHz: 1984.0000 CPU min MHz: 115.2000 BogoMIPS: 62.50 L1d cache: 256 KiB
L1i cache: 256 KiB L2 cache: 1 MiB L3 cache: 2 MiB Vulnerability Gather data sampling: Not affected
Vulnerability Itlb multihit: Not affected Vulnerability L1tf: Not affected Vulnerability Mds: Not
affected Vulnerability Meltdown: Not affected Vulnerability Mmio stale data: Not affected
Vulnerability Retbleed: Not affected Vulnerability Spec rstack overflow: Not affected Vulnerability
Spec store bypass: Mitigation; Speculative Store Bypass disabled via prctl Vulnerability Spectre v1:
Mitigation; \_\_user pointer sanitization Vulnerability Spectre v2: Mitigation; CSV2, but not BHB
Vulnerability Srbds: Not affected Vulnerability Tsx async abort: Not affected Flags: fp asimd
evtstrm aes pmull sha1 sha2 crc32 atomics fphp asimdhp cpuid asimdrdm lrcpc dcpop asimddp uscat
ilrcpc flagm Disk: Filesystem Size Used Avail Use% Mounted on /dev/nvme0n1p1 79G 24G 51G 32% / none
7.5G 0 7.5G 0% /dev tmpfs 7.6G 52K 7.6G 1% /dev/shm tmpfs 1.6G 165M 1.4G 11% /run tmpfs 5.0M 4.0K
5.0M 1% /run/lock tmpfs 7.6G 0 7.6G 0% /sys/fs/cgroup tmpfs 1.6G 20K 1.6G 1% /run/user/124 tmpfs
1.6G 36K 1.6G 1% /run/user/1000 /dev/sda1 30G 14G 17G 45% /media/tomc23/BRADY

Installed Packages (key ones): ii docker-compose 1.25.0-1 all Punctual, lightweight development
environments using Docker ii docker.io 26.1.3-0ubuntu1~20.04.1 arm64 Linux container runtime ii
libopencv-python 4.5.4-8-g3e4c170df4 arm64 Open Computer Vision Library ii libpython2-stdlib:arm64
2.7.17-2ubuntu4 arm64 interactive high-level object-oriented language (Python2) ii
libpython2.7:arm64 2.7.18-1~20.04.7 arm64 Shared Python runtime library (version 2.7) ii
libpython2.7-minimal:arm64 2.7.18-1~20.04.7 arm64 Minimal subset of the Python language (version
2.7) ii libpython2.7-stdlib:arm64 2.7.18-1~20.04.7 arm64 Interactive high-level object-oriented
language (standard library, version 2.7) ii libpython3-stdlib:arm64 3.8.2-0ubuntu2 arm64 interactive
high-level object-oriented language (default python3 version) ii libpython3.8:arm64
3.8.10-0ubuntu1~20.04.18 arm64 Shared Python runtime library (version 3.8) ii
libpython3.8-minimal:arm64 3.8.10-0ubuntu1~20.04.18 arm64 Minimal subset of the Python language
(version 3.8) ii libpython3.8-stdlib:arm64 3.8.10-0ubuntu1~20.04.18 arm64 Interactive high-level
object-oriented language (standard library, version 3.8) ii libpython3.9-minimal:arm64
3.9.5-3ubuntu0~20.04.1 arm64 Minimal subset of the Python language (version 3.9) ii
libpython3.9-stdlib:arm64 3.9.5-3ubuntu0~20.04.1 arm64 Interactive high-level object-oriented
language (standard library, version 3.9) ii nodejs 20.19.4-1nodesource1 arm64 Node.js event-based
server-side javascript engine ii nvidia-docker2 2.11.0-1 all nvidia-docker CLI wrapper ii postgresql
12+214ubuntu0.1 all object-relational SQL database (supported version) ii postgresql-12
12.22-0ubuntu0.20.04.4 arm64 object-relational SQL database, version 12 server ii
postgresql-client-12 12.22-0ubuntu0.20.04.4 arm64 front-end programs for PostgreSQL 12 ii
postgresql-client-common 214ubuntu0.1 all manager for multiple PostgreSQL client versions ii
postgresql-common 214ubuntu0.1 all PostgreSQL database-cluster manager ii postgresql-contrib
12+214ubuntu0.1 all additional facilities for PostgreSQL (supported version) ii python-apt-common
2.0.1ubuntu0.20.04.1 all Python interface to libapt-pkg (locales) ii python-dbus 1.2.16-1build1
arm64 simple interprocess messaging system (Python interface) ii python-gobject-2 2.28.6-14ubuntu1
arm64 deprecated static Python bindings for the GObject library ii python-is-python3 3.8.2-4 all
symlinks /usr/bin/python to python3 ii python-jetson-gpio 2.1.6ubuntu1 arm64 Jetson GPIO library
package (Python 2) ii python-matplotlib-data 3.1.2-1ubuntu4 all Python based plotting system (data
package) ii python2 2.7.17-2ubuntu4 arm64 interactive high-level object-oriented language (Python2
version) ii python2-minimal 2.7.17-2ubuntu4 arm64 minimal subset of the Python2 language ii
python2.7 2.7.18-1~20.04.7 arm64 Interactive high-level object-oriented language (version 2.7) ii
python2.7-minimal 2.7.18-1~20.04.7 arm64 Minimal subset of the Python language (version 2.7) ii
python3 3.8.2-0ubuntu2 arm64 interactive high-level object-oriented language (default python3
version) ii python3-acme 1.1.0-1ubuntu0.1 all ACME protocol library for Python 3 ii python3-apport
2.20.11-0ubuntu27.31 all Python 3 library for Apport crash report handling ii python3-apt
2.0.1ubuntu0.20.04.1 arm64 Python 3 interface to libapt-pkg ii python3-aptdaemon
1.1.1+bzr982-0ubuntu32.3 all Python 3 module for the server and client of aptdaemon ii
python3-aptdaemon.gtk3widgets 1.1.1+bzr982-0ubuntu32.3 all Python 3 GTK+ 3 widgets to run an
aptdaemon client ii python3-attr 19.3.0-2 all Attributes without boilerplate (Python 3) ii
python3-bcrypt 3.1.7-2ubuntu1 arm64 password hashing library for Python 3 ii python3-blinker
1.4+dfsg1-0.3ubuntu1 all fast, simple object-to-object and broadcast signaling library ii
python3-brlapi:arm64 6.0+dfsg-4ubuntu6 arm64 Braille display access via BRLTTY - Python3 bindings ii
python3-cached-property 1.5.1-4 all Provides cached-property for decorating methods in classes
(Python 3) ii python3-cairo:arm64 1.16.2-2ubuntu2 arm64 Python3 bindings for the Cairo vector
graphics library ii python3-certbot 0.40.0-1ubuntu0.1 all main library for certbot ii
python3-certifi 2019.11.28-1 all root certificates for validating SSL certs and verifying TLS hosts
(python3) ii python3-cffi-backend 1.14.0-1build1 arm64 Foreign Function Interface for Python 3
calling C code - runtime ii python3-chardet 3.0.4-4build1 all universal character encoding detector
for Python3 ii python3-click 7.0-3 all Wrapper around optparse for command line utilities - Python
3.x ii python3-colorama 0.4.3-1build1 all Cross-platform colored terminal text in Python - Python
3.x ii python3-configargparse 0.13.0-2 all replacement for argparse with config files and
environment variables (Python 3) ii python3-configobj 5.0.6-4ubuntu0.1 all simple but powerful
config file reader and writer for Python 3 ii python3-crypto 2.6.1-13ubuntu2 arm64 cryptographic
algorithms and protocols for Python 3 ii python3-cryptography 2.8-3ubuntu0.3 arm64 Python library
exposing cryptographic recipes and primitives (Python 3) ii python3-cups 1.9.73-3build1 arm64
Python3 bindings for CUPS ii python3-cupshelpers 1.5.12-0ubuntu1.1 all Python utility modules around
the CUPS printing system ii python3-cycler 0.10.0-3 all composable kwarg iterator (Python 3) ii
python3-dateutil 2.7.3-3ubuntu1 all powerful extensions to the standard Python 3 datetime module ii
python3-dbus 1.2.16-1build1 arm64 simple interprocess messaging system (Python 3 interface) ii
python3-dbusmock 0.19-1 all mock D-Bus objects for tests ii python3-debconf 1.5.73 all interact with
debconf from Python 3 ii python3-debian 0.1.36ubuntu1.1 all Python 3 modules to work with
Debian-related data formats ii python3-decorator 4.4.2-0ubuntu1 all simplify usage of Python
decorators by programmers ii python3-defer 1.0.6-2.1 all Small framework for asynchronous
programming (Python 3) ii python3-distro 1.4.0-1 all Linux OS platform information API ii
python3-distro-info 0.23ubuntu1.1 all information about distributions' releases (Python 3 module) ii
python3-distupgrade 1:20.04.41 all manage release upgrades ii python3-distutils
3.8.10-0ubuntu1~20.04 all distutils package for Python 3.x ii python3-dnspython 1.16.0-1ubuntu1 all
DNS toolkit for Python 3 ii python3-docker 4.1.0-1 all Python 3 wrapper to access docker.io's
control socket ii python3-dockerpty 0.4.1-2 all Pseudo-tty handler for docker Python client (Python
3.x) ii python3-docopt 0.6.2-2.2ubuntu1 all command-line interface description language (Python3) ii
python3-entrypoints 0.3-2ubuntu1 all Discover and load entry points from installed packages
(Python 3) ii python3-fasteners 0.14.1-2 all provides useful locks - Python 3.x ii python3-future
0.18.2-2ubuntu0.1 all Clean single-source support for Python 3 and 2 - Python 3.x ii python3-gi
3.36.0-1 arm64 Python 3 bindings for gobject-introspection libraries ii python3-gi-cairo 3.36.0-1
arm64 Python 3 Cairo bindings for the GObject library ii python3-gpg 1.13.1-7ubuntu2.2 arm64 Python
interface to the GPGME GnuPG encryption library (Python 3) ii python3-httplib2 0.14.0-1ubuntu1 all
comprehensive HTTP client library written for Python3 ii python3-ibus-1.0 1.5.22-2ubuntu2.1 all
Intelligent Input Bus - introspection overrides for Python (Python 3) ii python3-icu 2.4.2-0ubuntu3
arm64 Python 3 extension wrapping the ICU C++ API ii python3-idna 2.8-1ubuntu0.1 all Python IDNA2008
(RFC 5891) handling (Python 3) ii python3-importlib-metadata 1.5.0-1 all library to access the
metadata for a Python package - Python 3.x ii python3-jetson-gpio 2.1.6ubuntu1 arm64 Jetson GPIO
library package (Python 3) ii python3-josepy 1.2.0-2 all JOSE implementation for Python 3.x ii
python3-jsonschema 3.2.0-0ubuntu2 all An(other) implementation of JSON Schema (Draft 3 and 4) -
Python 3.x ii python3-jwt 1.7.1-2ubuntu2.1 all Python 3 implementation of JSON Web Token ii
python3-keyring 18.0.1-2ubuntu1 all store and access your passwords safely - Python 3 version of the
package ii python3-kiwisolver 1.0.1-3build1 arm64 fast implementation of the Cassowary constraint
solver - Python 3.X ii python3-launchpadlib 1.10.13-1 all Launchpad web services client library
(Python 3) ii python3-lazr.restfulclient 0.14.2-2build1 all client for lazr.restful-based web
services (Python 3) ii python3-lazr.uri 1.0.3-4build1 all library for parsing, manipulating, and
generating URIs ii python3-ldb 2:2.4.4-0ubuntu0.20.04.2 arm64 Python 3 bindings for LDB ii
python3-lib2to3 3.8.10-0ubuntu1~20.04 all Interactive high-level object-oriented language (lib2to3)
ii python3-libnvinfer 8.5.2-1+cuda11.4 arm64 Python 3 bindings for TensorRT ii
python3-libnvinfer-dev 8.5.2-1+cuda11.4 arm64 Python 3 development package for TensorRT ii
python3-lockfile 1:0.12.2-2ubuntu2 all file locking library for Python — Python 3 library ii
python3-louis 3.12.0-3ubuntu0.2 all Python bindings for liblouis ii python3-macaroonbakery 1.3.1-1
all Higher-level macaroon operations for Python 3 ii python3-mako 1.1.0+ds1-1ubuntu2.1 all fast and
lightweight templating for the Python 3 platform ii python3-markdown 3.1.1-3 all text-to-HTML
conversion library/tool (Python 3 version) ii python3-markupsafe 1.1.0-1build2 arm64 HTML/XHTML/XML
string library for Python 3 ii python3-matplotlib 3.1.2-1ubuntu4 arm64 Python based plotting system
in a style similar to Matlab (Python 3) ii python3-minimal 3.8.2-0ubuntu2 arm64 minimal subset of
the Python language (default python3 version) ii python3-mock 3.0.5-1build1 all Mocking and Testing
Library (Python3 version) ii python3-monotonic 1.5-0ubuntu2 all implementation of time.monotonic() -
Python 3.x ii python3-more-itertools 4.2.0-1build1 all library with routines for operating on
iterables, beyond itertools (Python 3) ii python3-nacl 1.3.0-5 arm64 Python bindings to libsodium
(Python 3) ii python3-numpy 1:1.17.4-5ubuntu3.1 arm64 Fast array facility to the Python 3 language
ii python3-oauthlib 3.1.0-1ubuntu2 all generic, spec-compliant implementation of OAuth for Python3
ii python3-olefile 0.46-2 all Python module to read/write MS OLE2 files ii python3-openssl
19.0.0-1build1 all Python 3 wrapper around the OpenSSL library ii python3-packaging 20.3-1 all core
utilities for python3 packages ii python3-pam 0.4.2-13.2ubuntu8 arm64 Python interface to the PAM
library ii python3-pandas 0.25.3+dfsg-7 all data structures for "relational" or "labeled" data ii
python3-pandas-lib 0.25.3+dfsg-7 arm64 low-level implementations and bindings for pandas ii
python3-paramiko 2.6.0-2ubuntu0.3 all Make ssh v2 connections (Python 3) ii python3-parsedatetime
2.4-5 all Python 3 module to parse human-readable date/time expressions ii python3-pbr
5.4.5-0ubuntu1 all inject useful and sensible default behaviors into setuptools - Python 3.x ii
python3-pexpect 4.6.0-1build1 all Python 3 module for automating interactive applications ii
python3-pil:arm64 7.0.0-4ubuntu0.9 arm64 Python Imaging Library (Python3) ii python3-pkg-resources
45.2.0-1ubuntu0.3 all Package Discovery and Resource Access using pkg_resources ii
python3-problem-report 2.20.11-0ubuntu27.31 all Python 3 library to handle problem reports ii
python3-protobuf 3.6.1.3-2ubuntu5.2 arm64 Python 3 bindings for protocol buffers ii
python3-ptyprocess 0.6.0-1ubuntu1 all Run a subprocess in a pseudo terminal from Python 3 ii
python3-pyatspi 2.36.0-1 all Assistive Technology Service Provider Interface - Python3 bindings ii
python3-pygments 2.3.1+dfsg-1ubuntu2.2 all syntax highlighting package written in Python 3 ii
python3-pyinotify 0.9.6-1.2ubuntu1 all simple Linux inotify Python bindings ii python3-pymacaroons
0.13.0-3 all Macaroon library for Python 3 ii python3-pyparsing 2.4.6-1 all alternative to creating
and executing simple grammars - Python 3.x ii python3-pyrsistent:arm64 0.15.5-1build1 arm64
persistent/functional/immutable data structures for Python ii python3-requests 2.22.0-2ubuntu1.1 all
elegant and simple HTTP library for Python3, built for human beings ii python3-requests-toolbelt
0.8.0-1.1 all Utility belt for advanced users of python3-requests ii python3-requests-unixsocket
0.2.0-2 all Use requests to talk HTTP via a UNIX domain socket - Python 3.x ii python3-rfc3339 1.1-2
all parser and generator of RFC 3339-compliant timestamps (Python 3) ii python3-samba
2:4.15.13+dfsg-0ubuntu0.20.04.8 arm64 Python 3 bindings for Samba ii python3-scipy 1.3.3-3build1
arm64 scientific tools for Python 3 ii python3-secretstorage 2.3.1-2ubuntu1 all Python module for
storing secrets - Python 3.x version ii python3-setuptools 45.2.0-1ubuntu0.3 all Python3 Distutils
Enhancements ii python3-simplejson 3.16.0-2ubuntu2 arm64 simple, fast, extensible JSON
encoder/decoder for Python 3.x ii python3-six 1.14.0-2 all Python 2 and 3 compatibility library
(Python 3 interface) ii python3-software-properties 0.99.9.12 all manage the repositories that you
install software from ii python3-speechd 0.9.1-4 all Python interface to Speech Dispatcher ii
python3-systemd 234-3build2 arm64 Python 3 bindings for systemd ii python3-talloc:arm64
2.3.3-0ubuntu0.20.04.1 arm64 hierarchical pool based memory allocator - Python3 bindings ii
python3-tdb 1.4.5-0ubuntu0.20.04.1 arm64 Python3 bindings for TDB ii python3-texttable 1.6.2-2 all
Module for creating simple ASCII tables — python3 ii python3-tk:arm64 3.8.10-0ubuntu1~20.04 arm64
Tkinter - Writing Tk applications with Python 3.x ii python3-tz 2019.3-1ubuntu0.20.04.0 all Python3
version of the Olson timezone database ii python3-uno 1:6.4.7-0ubuntu0.20.04.15 arm64 Python-UNO
bridge ii python3-update-manager 1:20.04.10.23 all python 3.x module for update-manager ii
python3-urllib3 1.25.8-2ubuntu0.4 all HTTP library with thread-safe connection pooling for Python3
ii python3-urwid 2.0.1-3 arm64 curses-based UI/widget library for Python 3 ii python3-wadllib
1.3.3-3build1 all Python 3 library for navigating WADL files ii python3-websocket 0.53.0-2ubuntu1
all WebSocket client library - Python 3.x ii python3-xdg 0.26-1ubuntu1 all Python 3 library to
access freedesktop.org standards ii python3-xkit 0.5.0ubuntu4 all library for the manipulation of
xorg.conf files (Python 3) ii python3-yaml 5.3.1-1ubuntu0.1 arm64 YAML parser and emitter for
Python3 ii python3-zipp 1.0.0-1ubuntu0.1 all pathlib-compatible Zipfile object wrapper - Python 3.x
ii python3-zope.component 4.3.0-3 all Zope Component Architecture ii python3-zope.event 4.4-2build1
all Very basic event publishing system ii python3-zope.hookable 5.0.0-1build1 arm64 Hookable object
support ii python3-zope.interface 4.7.1-1 arm64 Interfaces for Python3 ii python3.8
3.8.10-0ubuntu1~20.04.18 arm64 Interactive high-level object-oriented language (version 3.8) ii
python3.8-minimal 3.8.10-0ubuntu1~20.04.18 arm64 Minimal subset of the Python language (version 3.8)
ii python3.8-vpi2 2.4.8 arm64 NVIDIA VPI python 3.8 bindings ii python3.9 3.9.5-3ubuntu0~20.04.1
arm64 Interactive high-level object-oriented language (version 3.9) ii python3.9-minimal
3.9.5-3ubuntu0~20.04.1 arm64 Minimal subset of the Python language (version 3.9) ii python3.9-vpi2
2.4.8 arm64 NVIDIA VPI python 3.9 bindings
